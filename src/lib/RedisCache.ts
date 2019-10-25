import * as Redis from 'ioredis';
import * as Redlock from 'redlock';

import { CachableValue, CacheInstance } from './CacheInstance';


/**
 * Wrapper class for using Redis as a cache.
 *
 * If no redis_strategy nor error event handler are defined, the client
 * will throw uncaught exceptions on stream errors! These must be defined,
 * or the process might crash unexpectedly.
 */
export class RedisCache extends CacheInstance {

  /**
   * We cannot store null and booleans in Redis, so we store
   * random values representing these values instead.
   */
  public static NULL_VALUE: string = 'f405eed4-507c-4aa5-a6d2-c1813d584b8f-NULL';
  public static TRUE_VALUE: string = 'f405eed4-507c-4aa5-a6d2-c1813d584b8f-TRUE';
  public static FALSE_VALUE: string = 'f405eed4-507c-4aa5-a6d2-c1813d584b8f-FALSE';
  public static JSON_PREFIX: string = 'f405eed4-507c-4aa5-a6d2-c1813d584b8f-JSON';

  /**
   * If a primary cluster goes down, it might take a few
   * minutes for ElastiCache to promote a read replica
   * to the new primary cluster. Here, we retry connecting for
   * at least 4 minutes before permanently fallbacking to
   * a local cache.
   */
  public static RETRY_DELAY: number = 5000;
  public static MAX_REDLOCK_RETRY_COUNT: number = 20;
  public static DEFAULT_REDIS_CLOCK_DRIFT_MS: number = 0.01;
  public static DEFAULT_REDLOCK_DELAY_MS: number = 200;
  public static DEFAULT_REDLOCK_JITTER_MS: number = 200;

  private redisClient: Redis.Redis;
  private ready: boolean = false;
  private url: string;
  private redlock: Redlock;

  constructor(redisUrl: string) {
    super();

    if (!redisUrl || !redisUrl.startsWith('redis://')) {
      throw new Error(`Invalid redis url ${redisUrl}.`);
    }

    this.url = redisUrl;
    this.redisClient = new Redis(redisUrl, {
      retryStrategy: () => RedisCache.RETRY_DELAY,
      // master failover
      reconnectOnError: (err: any) => err.message.startsWith('READONLY'),
      // This will prevent the get/setValue calls from hanging
      // if there is no active connection.
      enableOfflineQueue: false,
    });
    this.redlock = new Redlock([this.redisClient], {
      driftFactor: RedisCache.DEFAULT_REDIS_CLOCK_DRIFT_MS,
      retryCount: RedisCache.MAX_REDLOCK_RETRY_COUNT,
      retryDelay: RedisCache.DEFAULT_REDLOCK_DELAY_MS,
      retryJitter: RedisCache.DEFAULT_REDLOCK_JITTER_MS,
    });

    this.redisClient.on('ready', this.startConnectionStrategy.bind(this));
    this.redisClient.on('end', this.endConnectionStrategy.bind(this));
    this.redisClient.on('error', this.errorStrategy.bind(this));
  }

  /**
   * @inheritdoc
   */
  public async isReady(): Promise<void> {
    if (this.ready) {
      return;
    }
    return new Promise<void>(resolve => this.redisClient.on('ready', resolve));
  }

  /**
   * @inheritdoc
   */
  public async itemCount(): Promise<number> {
    return this.redisClient.dbsize();
  }

  /**
   * The error event is emitted on stream error.
   * We must catch it, otherwise it will crash the process
   * with an UncaughtException.
   */
  public errorStrategy(): void {
    this.emit('warn', 'Error while connected to the Redis cache!');
  }

  /**
   * The end event is emitted by the redis client when an
   * established connection has ended.
   */
  public endConnectionStrategy(err): void {
    this.emit('warn', 'Connection lost to Redis.', err);
  }

  /**
   * The connect event is emitted by the redis client as
   * soon as a new connection is established.
   */
  public startConnectionStrategy(): void {
    this.ready = true;
    this.emit('info', `Connection established to Redis at ${this.url}.`);
  }

  /**
   * Some values are not supported by Redis and/or by the
   * Redis client library.
   * As per the documentation:
   * > Please be aware that sending null, undefined and Boolean
   * > values will result in the value coerced to a string!
   *
   * We serialize these values to be able to store
   * and retrieve them as strings.
   *
   */
  public static serializeValue(value: CachableValue): CachableValue {

    if (value === null) {
      return RedisCache.NULL_VALUE;
    }

    if (value === true) {
      return RedisCache.TRUE_VALUE;
    }

    if (value === false) {
      return RedisCache.FALSE_VALUE;
    }

    if (value instanceof Object) {
      return RedisCache.JSON_PREFIX + JSON.stringify(value);
    }

    return value;

  }

  /**
   * Deserializes a value coming from Redis.
   *
   * As per the documentation:
   * > Minimal parsing is done on the replies. Commands that return a
   * > integer return JavaScript Numbers, arrays return JavaScript Array.
   * > HGETALL returns an Object keyed by the hash keys.
   *
   * also from the documentation:
   * > If the key is missing, reply will be null.
   *
   */
  public static deserializeValue(value: CachableValue): CachableValue {

    if (value === null) {
      // null means that the key was not present, which we interpret as undefined.
      return undefined;
    }

    if (value === RedisCache.NULL_VALUE) {
      return null;
    }

    if (value === RedisCache.TRUE_VALUE) {
      return true;
    }

    if (value === RedisCache.FALSE_VALUE) {
      return false;
    }

    if (value.startsWith(RedisCache.JSON_PREFIX)) {
      return JSON.parse(value.substring(RedisCache.JSON_PREFIX.length));
    }

    return value;

  }

  /**
   * @inheritdoc
   */
  public async setValue(
    key: string,
    value: CachableValue,
    ttl: number = 0,
  ): Promise<boolean> {
    try {
      return await this.setValueInternal(key, value, ttl);
    } catch (error) {
      /**
       * A timeout can occur if the connection was broken during
       * a value fetching. We don't want to hang forever if this is the case.
       */
      this.emit('warn', 'Error while setting value to Redis cache', error);
      return false;
    }
  }

  public async setValueInternal(
    key: string,
    value: CachableValue,
    ttl: number,
  ): Promise<boolean> {
    this.emit('set', key, value);

    if (value === undefined) {
      this.emit('warn', `Cannot set ${key} to undefined!`);
      return false;
    }

    value = RedisCache.serializeValue(value);

    let result;
    if (ttl !== 0) {
      result = await this.redisClient.set(key, value, 'EX', ttl.toString());
    } else {
      result = await this.redisClient.set(key, value);
    }

    return result === 'OK';
  }

  /**
   * @inheritdoc
   */
  public async getValue(key: string): Promise<CachableValue> {
    try {
      return await this.getValueInternal(key);
    } catch (error) {
      /**
       * A timeout can occur if the connection was broken during
       * a value fetching. We don't want to hang forever if this is the case.
       */
      this.emit('warn', 'Error while fetching value from the Redis cache', error);
      return undefined;
    }
  }

  private async getValueInternal(key: string): Promise<CachableValue> {
    const value = await this.redisClient.get(key);
    this.emit('get', key, value);
    return RedisCache.deserializeValue(value);
  }

  /**
   * @inheritdoc
   */
  public async getTtl(key: string): Promise<number | undefined> {
    try {
      const ttl = await this.redisClient.pttl(key);
      if (ttl === -1) {
        return 0;
      }
      if (ttl <= 0) {
        return undefined;
      }
      return ttl;
    } catch (error) {
      this.emit('warn', 'Error while fetching ttl from the Redis cache', error);
      return undefined;
    }
  }

  /**
   * @inheritdoc
   */
  public async delValue(key: string): Promise<void> {
    this.emit('del', key);
    await this.redisClient.del(key);
  }

  /**
   * @inheritdoc
   */
  public async clear(): Promise<void> {
    await this.redisClient.flushall();
  }

  /**
   * @inheritdoc
   */
  public async clearMemory(): Promise<void> {
    return;
  }

  /**
   * @inheritdoc
   * Locking through the redlock algorithm
   * https://redis.io/topics/distlock
   */
  public isLockingSupported(): boolean {
    return true;
  }

  /**
   * @inheritdoc
   */
  public async lock(resource: string, ttlMs: number): Promise<Redlock.Lock> {
    return this.redlock.lock(resource, ttlMs);
  }

  /**
   * @inheritdoc
   */
  public async unlock(lock: Redlock.Lock): Promise<void> {
    return this.redlock.unlock(lock);
  }
}
