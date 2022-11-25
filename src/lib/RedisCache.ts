import Redis from 'ioredis';
import * as Redlock from 'redlock';
import { Lock } from 'redlock';

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
  public static NULL_VALUE = 'f405eed4-507c-4aa5-a6d2-c1813d584b8f-NULL';
  public static TRUE_VALUE = 'f405eed4-507c-4aa5-a6d2-c1813d584b8f-TRUE';
  public static FALSE_VALUE = 'f405eed4-507c-4aa5-a6d2-c1813d584b8f-FALSE';
  public static JSON_PREFIX = 'f405eed4-507c-4aa5-a6d2-c1813d584b8f-JSON';
  public static ERROR_PREFIX = 'f405eed4-507c-4aa5-a6d2-c1813d584b8f-ERROR';

  public static REDIS_CONNECTION_TIMEOUT_MS = parseInt(process.env.REDIS_CONNECTION_TIMEOUT_MS as string, 10) || 5000;
  public static REDLOCK_RETRY_COUNT = parseInt(process.env.REDLOCK_RETRY_COUNT as string, 10) || 20; // lib. default: 10
  public static REDLOCK_RETRY_DELAY_MS = parseInt(process.env.REDLOCK_RETRY_DELAY_MS as string, 10) || 200; // lib. default: 200
  public static REDLOCK_CLOCK_DRIFT_FACTOR = parseInt(process.env.REDLOCK_CLOCK_DRIFT_FACTOR as string, 10) || 0.01; // lib. default: 0.01
  public static REDLOCK_JITTER_MS = parseInt(process.env.REDLOCK_JITTER_MS as string, 10) || 200; // lib. default: 200

  private redisClient: Redis;
  private ready = false;
  private url: string;
  // We manage several redlock instances because some options (like retryCount)
  // are set at redlock init. By having these options in our constructor too
  // (and only having one redlock with fixed behavior), we would be unable to
  // support mixing calls requiring one behavior, then another.
  // And so, we have as many redlocks as we need to honor these runtime needs.
  private redlock: Redlock;
  private redlockWithoutRetry: Redlock;

  constructor(redisUrl: string, readOnly = false) {
    super();

    if (!redisUrl || (!redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://'))) {
      throw new Error(`Invalid redis url ${redisUrl}.`);
    }

    this.url = redisUrl;
    this.redisClient = new Redis(redisUrl, {
      readOnly,
      retryStrategy: () => RedisCache.REDIS_CONNECTION_TIMEOUT_MS,
      // master failover
      reconnectOnError: (err: any) => !readOnly && err.message.startsWith('READONLY'),
      // This will prevent the get/setValue calls from hanging
      // if there is no active connection.
      enableOfflineQueue: false,
    });
    this.redlock = new Redlock([this.redisClient], {
      driftFactor: RedisCache.REDLOCK_CLOCK_DRIFT_FACTOR,
      retryCount: RedisCache.REDLOCK_RETRY_COUNT,
      retryDelay: RedisCache.REDLOCK_RETRY_DELAY_MS,
      retryJitter: RedisCache.REDLOCK_JITTER_MS,
    });
    this.redlockWithoutRetry = new Redlock([this.redisClient], {
      driftFactor: RedisCache.REDLOCK_CLOCK_DRIFT_FACTOR,
      retryCount: 0,
      retryDelay: 0,
      retryJitter: 0,
    });

    this.redisClient.on('ready', this.startConnectionStrategy.bind(this));
    this.redisClient.on('end', this.endConnectionStrategy.bind(this));
    this.redisClient.on('error', this.errorStrategy.bind(this));

    // TODO when migrating to Redlock v5: rename 'clientError' to 'error'
    this.redlock.on('clientError', this.redlockErrorStrategy.bind(this));
    this.redlockWithoutRetry.on('clientError', this.redlockErrorStrategy.bind(this));
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

  public redlockErrorStrategy(err: any): void {
    this.emit('warn', 'Redlock error:', err);
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

    if (value instanceof Error) {
      return RedisCache.ERROR_PREFIX + JSON.stringify({
        ...value, // serialize potential Error metadata set as object properties
        message: value.message,
      });
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

    if (value.startsWith(RedisCache.ERROR_PREFIX)) {
      const deserializedError = JSON.parse(value.substring(RedisCache.ERROR_PREFIX.length));
      // return error, restoring potential Error metadata set as object properties
      return Object.assign(new Error(deserializedError.message), deserializedError);
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
    ttl = 0,
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
      result = await this.redisClient.set(key, value, 'EX', ttl);
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
  public async lock(resource: string, ttlMs: number, retry = true): Promise<Lock> {
    const redlock = retry === false ? this.redlockWithoutRetry : this.redlock;
    return redlock.lock(resource, ttlMs);
  }

  /**
   * @inheritdoc
   */
  public async unlock(lock: Lock): Promise<void> {
    return this.redlock.unlock(lock);
  }

  /**
   * @inheritdoc
   *
   * Implementation note & usage ***warning***: looking at Redis docs and the www,
   *   there's no "index-backed" Redis function to do this in O(1).
   *
   * So, doing it with a Redis SCAN, https://redis.io/commands/scan . In many use cases it's okay,
   * 1. Because Redis SCAN is fast (10M keys / 40ms on a laptop)
   * 2. If your use case writes a reasonable number of locks, and sets reasonably-small TTLs,
   *    guaranteeing Redis contains a reasonable-to-scan volume of items (depending on your hardware).
   *
   * Recommendation: This implies **workloads relying on this function should
   * own their own Redis db**, to not scan through tons of unrelated keys.
   *
   * Implementation note: you might try to use instead a redis Hashmap / Set / Sorted set to group
   * "sublocks", to be able use H/S/Z Redis functions to query efficiently inside a group of locks.
   * That won't work in use cases where you need one TTL per lock, because it'd limit to one TTL
   * (associated to a Redis *value*!) per prefix. Thus, values with TTLs, thus, SCAN.
   */
  public async hasLock(prefix: string): Promise<boolean> {
    const redisPrefix = prefix.endsWith('*') ? prefix : `${prefix}*`;
    let cursor = '';
    while (cursor !== '0') { // indicates Redis completed the scan
      // Redis detail: we set the `count` option to a number (1000) greater than
      // the default (10), to minimize the amount of network round-trips caused
      // by incomplete scans needing more scanning from the returned cursor.
      const [nextCursor, matchingKeys] = await this.redisClient.scan(cursor || '0', 'MATCH', redisPrefix, 'COUNT', 1000);
      if (matchingKeys.length > 0) {
        return true;
      }
      cursor = nextCursor;
    }

    return false;
  }

  public async quit(): Promise<void> {
    await this.redisClient.quit();
  }

}
