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
  abstract getValue(key: string): Promise<CachableValue>;

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
  abstract setValue(key: string, value: CachableValue, ttl?: number): Promise<CachableValue>;

  /**
   * Delete a value from the cache.
   *
   * @param key        The key of the value to set.
   *
   */
  abstract delValue(key: string): Promise<void>;

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
   *
   * @returns       The cached or fetched value
   */
  public async getOrFetchValue(
    key: string,
    ttl: number,
    fetchFunction: FetchingFunction,
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

    // I'm the one fetching. It'll be the only await on the fetching function.
    const fetchPromise = this.activeFetches[key] = fetchFunction();
    try {
      const result = await fetchPromise;
      if (result !== undefined) {
        await this.setValue(key, result, ttl);
      }
      return result;
    } finally {
      delete this.activeFetches[key];
    }
  }

}
