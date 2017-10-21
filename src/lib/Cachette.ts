import * as assert from 'assert';

import { CachableValue, CacheInstance } from './CacheInstance';

import { LocalCache } from './LocalCache';
import { RedisCache } from './RedisCache';


export type FetchingFunction = () => Promise<CachableValue>;

export namespace Cachette {

  let localCacheInstance: CacheInstance = null;
  let mainCacheInstance: CacheInstance = null;

  /**
   * Keep track of active fetches to prevent
   * simultaneous requests to the same resource in parallel.
   */
  const activeFetches: { [key: string]: Promise<CachableValue> } = {};

  /**
   * Get or fetch a value
   *
   * @param key     The key of the value to get
   * @param ttl     The time to live of the value in seconds.
   * @param fetchFn The function that can retrieve the original value
   *
   * @returns       The cached or fetched value
   */
  export async function getOrFetchValue(
    key: string,
    ttl: number,
    fetchFunction: FetchingFunction,
  ): Promise<CachableValue> {
    const instance = getCacheInstance();
    // already cached?
    const cached = await instance.getValue(key);
    if (cached !== undefined) {
      return cached;
    }

    // already fetching?
    const currentFetch = activeFetches[key];
    if (currentFetch) {
      return currentFetch;
    }

    // I'm the one fetching. It'll be the only await on the fetching function.
    const fetchPromise = activeFetches[key] = fetchFunction();
    try {
      const result = await fetchPromise;
      if (result !== undefined) {
        await instance.setValue(key, result, ttl);
      }
      return result;
    } finally {
      delete activeFetches[key];
    }
  }


  /**
   * Returns the cache instance.
   */
  export function getCacheInstance(): CacheInstance {

    if (mainCacheInstance) {
      return mainCacheInstance;
    }

    if (localCacheInstance) {
      return localCacheInstance;
    }

    console.log('The cache is used before initialization! Using a local cache.'); // tslint:disable-line
    localCacheInstance = new LocalCache();
    return localCacheInstance;
  }

  /**
   * Set the main cache instance. Will overwrite any existing instance
   */
  export function setCacheInstance(instance: CacheInstance): void {
    mainCacheInstance = instance;
  }

  /**
   * Connect to the cache provider (local or remote).
   * Processes intending to use the Redis cache should call
   * this function first, as calling getCache directly will
   * default to using a local cache.
   */
  export async function connect(redisUrl?: string): Promise<void> {

    if (mainCacheInstance !== null) {
      return;
    }

    /**
     * No matter if we intend to use a redis cache, a local cache
     * instance is instantiated, because it might be used if the
     * redis instance is temporarily unavailable.
     */
    if (localCacheInstance === null) {
      localCacheInstance = new LocalCache();
    }

    if (redisUrl && redisUrl.startsWith('redis://')) {
      new RedisCache(redisUrl); // tslint:disable-line
    }

    if (mainCacheInstance === null) {
      // No redis URL provided. Only using local cache.
      mainCacheInstance = localCacheInstance;
    }

  }

  /**
   * disconnect all the caches. Mostly use for testing.
   */
  export function disconnect(): void {
    localCacheInstance = null;
    mainCacheInstance = null;
  }

  /**
   * decorator
   */
  export function cached(ttl?: number): any {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
      assert(
        target['buildCacheKey'],
        'Need to define buildCacheKey on the class to use the decorator "cached"',
      );
      const origFunction = descriptor.value;
      // don't use an => function here, or you lose access to 'this'
      const newFunction = function (...args): Promise<CachableValue> {
        const key = this.buildCacheKey(propertyKey, args);
        const fetchFunction = origFunction.bind(this, ...args);
        return getOrFetchValue(key, ttl, fetchFunction);
      };
      descriptor.value = newFunction;
      return descriptor;
    };
  }

}
