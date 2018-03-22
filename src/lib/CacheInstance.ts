import * as EventEmitter from 'events';

export type CachableValue = any;
export type FetchingFunction = () => Promise<CachableValue>;


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
  public abstract getValue(key: string): Promise<CachableValue>;

  /**
   * Set a value in the cache.
   *
   * @param key        The key of the value to set.
   * @param value      The value to set.
   * @param ttl        The time to live of the value in seconds.
   *                   By default, the value will not expire
   *
   * @return true if the value was stored, false otherwise.
   */
  public abstract setValue(key: string, value: CachableValue, ttl?: number): Promise<boolean>;

  /**
   * Delete a value from the cache.
   *
   * @param key        The key of the value to set.
   *
   */
  public abstract delValue(key: string): Promise<void>;

  /**
   * Determines if locking is supported in the cache implementation
   */
  public isLockSupported(): boolean {
    return false;
  }

  /**
   * Globally lock a named resource
   *
   * @param resource    The name of the resource to lock
   * @param ttlMs       The time to live of the lock in ms
   *
   * @returns           The lock, an opaque object that must be passed to unlock()
   */
  protected lock(resource: string, ttlMs: number): Promise<any> {
    throw new Error('unsupported');
  }

  /**
   * Unlock a named resource aquired with lock()
   *
   * @param lock        The lock object
   */
  protected unlock(lock: any): Promise<void> {
    throw new Error('unsupported');
  }


  /**
   * Keep track of active fetches to prevent
   * simultaneous requests to the same resource in parallel.
   */
  private activeFetches: { [key: string]: Promise<CachableValue> } = {};

  /**
   * Get or fetch a value
   *
   * @param key     The key of the value to get
   * @param ttl     The time to live of the value in seconds.
   * @param fetchFn The function that can retrieve the original value
   * @param lockTtl Global distributed lock TTL (in seconds) protecting fetching.
   *                If undefined, 0 or falsy, locking is not preformed
   *
   * @returns       The cached or fetched value
   */
  public async getOrFetchValue(
    key: string,
    ttl: number,
    fetchFunction: FetchingFunction,
    lockTtl?: number,
  ): Promise<CachableValue> {

    // already cached?
    const cached = await this.getValue(key);
    if (cached !== undefined) {
      return cached;
    }

    // already fetching?
    const currentFetch = this.activeFetches[key];
    if (currentFetch) {
      return currentFetch;
    }

    // I'm the one fetching.
    let lock: any;
    try {
      // get the lock if needed
      const lockName = `lock__${key}`;
      if (lockTtl && this.isLockSupported()) {
        lock = await this.lock(lockName, lockTtl * 1000);
        // check if the value has been populated while we were locking
        const cachedValue = await this.getValue(key);
        if (cachedValue !== undefined) {
          return cachedValue;
        }
      }

      // fetch!
      const fetchPromise = this.activeFetches[key] = fetchFunction();

      const result = await fetchPromise;
      if (result !== undefined) {
        await this.setValue(key, result, ttl);
      }
      return result;
    } finally {
      if (lock) {
        await this.unlock(lock);
      }
      delete this.activeFetches[key];
    }
  }

}
