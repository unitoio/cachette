import * as util from 'util';

const redis = require('redis');
import * as Bluebird from 'bluebird';

import { cachableValue, CacheInstance } from './CacheInstance';
import { Cachette } from './Cachette';


Bluebird.promisifyAll(redis.RedisClient.prototype);
Bluebird.promisifyAll(redis.Multi.prototype);

process.env.LOG_LEVEL = 'disabled';

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
  public static MAX_RETRY_COUNT: number = 48;
  public static RETRY_DELAY: number = 5000;

  private client: any = null;

  constructor(redisUrl: string) {
    super();
    this.emit('info', `Connecting to Redis at ${redisUrl}.`);
    this.client = redis.createClient({
      url: redisUrl,
      retry_strategy: RedisCache.retryStrategy,
      // This will prevent the get/setValue calls from hanging
      // if there is no active connection.
      enable_offline_queue: false,
    });
    this.client.on('connect', this.startConnectionStrategy.bind(this));
    this.client.on('end', RedisCache.endConnectionStrategy);
    this.client.on('error', RedisCache.errorStrategy);
  }

  /**
   * The error event is emitted on stream error.
   * We must catch it, otherwise it will crash the process
   * with an UncaughtException.
   */
  public static errorStrategy(): void {
    Cachette.logger.error(`Error while connected to the Redis cache!`);
    Cachette.setCacheInstance(null);
  }

  /**
   * The end event is emitted by the redis client when an
   * established connection has ended.
   */
  public static endConnectionStrategy(): void {
    Cachette.logger.warn(`Connection lost to Redis.`);
    /**
     * Falling back to using a local cache while we reconnect.
     */
    Cachette.setCacheInstance(null);
  }

  /**
   * The connect event is emitted by the redis client as
   * soon as a new connection is established.
   */
  public startConnectionStrategy(): void {
    Cachette.logger.info(`Connection established to Redis.`);
    Cachette.setCacheInstance(this);
  }

  /**
   * Custom connection retry strategy used by the redis client.
   * For details of the properties of the options object,
   * see https://github.com/NodeRedis/node_redis#options-object-properties
   */
  public static retryStrategy(options): number {

    // This means we are unable to connect when starting the service.
    if (options.times_connected === 0) {
      Cachette.logger.error('Unable to connect to the Redis instance!');
      return null;
    }

    // The attempt counter goes back to 0 everytime the connection
    // is re-established.
    if (options.attempt > RedisCache.MAX_RETRY_COUNT) {
      Cachette.logger.error('Maximum number of connection attempts reached.');
      return null;
    }

    Cachette.logger.info(`Trying to reconnect in ${RedisCache.RETRY_DELAY} ms.`);
    return RedisCache.RETRY_DELAY;

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
  public static serializeValue(value: cachableValue): cachableValue {

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
  public static deserializeValue(value: cachableValue): cachableValue {

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
   * Returns the list of parameters to be sent to the set
   * function.
   */
  public static buildSetArguments(key: string, value: cachableValue, ttl: number = undefined, overwrite: boolean = true): any[] {

    const setArguments = [key, value];

    if (ttl !== undefined) {
      // By default the keys do not expire in Redis.
      setArguments.push('EX');
      setArguments.push(ttl.toString());
    }

    if (overwrite === false) {
      setArguments.push('NX');
    }

    return setArguments;

  }

  /**
   * @inheritdoc
   */
  public async setValue(
    key: string,
    value: cachableValue,
    ttl: number = undefined,
    overwrite: boolean = true,
  ): Promise<boolean> {
    try {
      return await this.setValueInternal(key, value, ttl, overwrite);
    } catch (error) {
      /**
       * A timeout can occur if the connection was broken during
       * a value fetching. We don't want to hang forever if this is the case.
       */
      this.emit('error', `Error while setting value to Redis cache ${util.inspect(error)}`);
      return false;
    }
  }

  public async setValueInternal(
    key: string,
    value: cachableValue,
    ttl: number,
    overwrite: boolean,
  ): Promise<boolean> {
    this.emit('set', key, value);

    if (value === undefined) {
      throw new Error(`Cannot set ${key} to undefined!`);
    }

    value = RedisCache.serializeValue(value);

    const setArguments = RedisCache.buildSetArguments(key, value, ttl, overwrite);
    // bind returns a new function, so it's safe to call it directly
    // on the redis client instance.
    const result = await this.client.setAsync.bind(this.client, setArguments)();
    return result === 'OK' ? true : false;
  }

  /**
   * @inheritdoc
   */
  public async getValue(key: string): Promise<cachableValue> {
    try {
      return await this.getValueInternal(key);
    } catch (error) {
      /**
       * A timeout can occur if the connection was broken during
       * a value fetching. We don't want to hang forever if this is the case.
       */
      this.emit('error', `Error while fetching value from the Redis cache ${util.inspect(error)}`);
      return undefined;
    }
  }

  private async getValueInternal(key: string): Promise<cachableValue> {
    const value = await this.client.getAsync(key);
    this.emit('get', key, value);
    return RedisCache.deserializeValue(value);
  }

}
