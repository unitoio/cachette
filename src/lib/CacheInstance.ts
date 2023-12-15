import { EventEmitter } from 'node:events';

export type CachableValue = any;
export type FetchingFunction = () => Promise<CachableValue>;


export abstract class CacheInstance extends EventEmitter {

  /**
   * Will resolve when the cache instance connection is ready.
   */
  public abstract isReady(): Promise<void>;

  /**
   * Get the number of items in the cache.
   */
  public abstract itemCount(): Promise<number>;

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
   * Get the TTL of an entry, in ms
   *
   * @param key   The key of the entry whose ttl to retrieve
   *
   * @return      The remaining TTL on the entry, in ms.
   *              undefined if the entry does not exist.
   *              0 if the entry does not expire.
   */
  public abstract getTtl(key: string): Promise<number | undefined>;

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
   * clear the whole cache
   */
  public abstract clear(): Promise<void>;

  /**
   * clear any in-memory cache item.
   */
  public abstract clearMemory(): Promise<void>;

  /**
   * Determines if locking is supported in the cache implementation
   */
  public isLockingSupported(): boolean {
    return false;
  }

  /**
   * Globally lock a named resource
   *
   * @param resource    The name of the resource to lock
   * @param ttlMs       The time to live of the lock in ms
   * @param retry       Whether or not to retry attempts to lock
   *
   * @returns           The lock, an opaque object that must be passed to unlock()
   */
  public lock(resource: string, ttlMs: number, retry?: boolean): Promise<any> {
    throw new Error('unsupported');
  }

  /**
   * Unlock a named resource aquired with lock()
   *
   * @param lock        The lock object
   */
  public unlock(lock: any): Promise<void> {
    throw new Error('unsupported');
  }

  /**
   * Determine whether *at least one non-expired lock* starts with the given pattern.
   */
  public hasLock(prefix: string): Promise<boolean> {
    throw new Error('unsupported');
  }

  /**
   * Terminate / exit / quit the instance
   */
  public quit(): Promise<void> {
    return new Promise((resolve) => { resolve() });
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
   * @param shouldCacheError A callback being passed errors, controlling whether
   *                         to cache or not errors. Defaults to never cache.
   *
   * @returns       The cached or fetched value
   */
  public async getOrFetchValue<F extends FetchingFunction = FetchingFunction>(
    key: string,
    ttl: number,
    fetchFunction: F,
    lockTtl?: number,
    shouldCacheError?: (err: Error) => boolean,
  ): Promise<ReturnType<F>> {

    // already cached?
    let cached = await this.getValue(key);
    if (cached instanceof Error) {
      if (shouldCacheError) {
        throw cached;
      } else {
        cached = undefined;
      }
    }
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
      if (lockTtl && this.isLockingSupported()) {
        lock = await this.lock(lockName, lockTtl * 1000);
        // check if the value has been populated while we were locking
        let cachedValue = await this.getValue(key);
        if (cachedValue instanceof Error) {
          if (shouldCacheError) {
            throw cachedValue;
          } else {
            cachedValue = undefined;
          }
        }
        if (cachedValue !== undefined) {
          return cachedValue;
        }
      }

      // fetch!
      let error: Error | undefined;
      let result: any;
      try {
        const fetchPromise = this.activeFetches[key] = fetchFunction();
        result = await fetchPromise;
      } catch (err) {
        error = err;
      }

      // cache! results: always, errors: only if satisfying user assertion
      if (error && shouldCacheError && shouldCacheError(error)) {
        await this.setValue(key, error, ttl);
      } else if (result !== undefined) {
        await this.setValue(key, result, ttl);
      }

      if (error) {
        throw error;
      }
      return result;
    } finally {
      delete this.activeFetches[key];
      if (lock) {
        await this.unlock(lock);
      }
    }
  }

}
