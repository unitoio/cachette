const LRU = require('lru-cache');

import { cachableValue, CacheInstance } from './CacheInstance';


export class LocalCache extends CacheInstance {

  public static MAXIMUM_CACHE_SIZE: number = 5000;

  private cache: any = LRU({
    max: LocalCache.MAXIMUM_CACHE_SIZE,
    stale: false,
  });

  /**
   * @inheritdoc
   */
  public async setValue(key: string, value: cachableValue, ttl: number = 0, overwrite: boolean = true): Promise<boolean> {
    this.emit('set', key, value);

    if (value === undefined) {
      throw new Error(`Cannot set ${key} to undefined!`);
    }

    if (overwrite || !this.cache.has(key)) {
      // The lru cache interprets 0 as no expiration date.
      if (ttl === 0) {
        this.cache.set(key, value);
      } else {
        this.cache.set(key, value, ttl * 1000);
      }
      return true;
    }

    return false;
  }

  /**
   * @inheritdoc
   */
  public async getValue(key: string): Promise<string> {
    const value = await this.cache.get(key);
    this.emit('get', key, value);
    return value;
  }

}
