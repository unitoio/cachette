import * as assert from 'assert';

import { CachableValue, CacheInstance } from './CacheInstance';

import { LocalCache } from './LocalCache';
import { RedisCache } from './RedisCache';


export namespace Cachette {

  let localCacheInstance: CacheInstance | null = null;
  let mainCacheInstance: CacheInstance | null = null;

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
  export function setCacheInstance(instance: CacheInstance | null): void {
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

    if (redisUrl) {
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
  export function cached(ttl: number = 0): any {
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
        return this['cache'].getOrFetchValue(key, ttl, fetchFunction);
      };
      descriptor.value = newFunction;
      return descriptor;
    };
  }

}
