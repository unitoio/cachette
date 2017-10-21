import * as EventEmitter from 'events';

export type CachableValue = any;


export abstract class CacheInstance extends EventEmitter {

  /**
   * Get a value from the cache.
   *
   * @param key   The key of the value to get.
   *
   * @return      The value associated with the key, or undefined if
   *              no such value exists.
   *
   */
  abstract getValue(key: string): Promise<CachableValue>;

  /**
   * Set a value in the cache.
   *
   * @param key        The key of the value to set.
   * @param value      The value to set.
   * @param ttl        The time to live of the value in seconds.
   *                   By default, the value will not expire
   *
   * @return the now-cached value
   */
  abstract setValue(key: string, value: CachableValue, ttl?: number): Promise<CachableValue>;

  /**
   * Delete a value from the cache.
   *
   * @param key        The key of the value to set.
   *
   */
  abstract delValue(key: string): Promise<void>;

}
