const LRU = require('lru-cache');

import { CachableValue, CacheInstance } from './CacheInstance';


export class LocalCache extends CacheInstance {

  public static MAXIMUM_CACHE_SIZE: number = 5000;

  private cache: any = LRU({
    max: LocalCache.MAXIMUM_CACHE_SIZE,
    stale: false,
  });

  /**
   * @inheritdoc
   */
  public async setValue(key: string, value: CachableValue, ttl: number = 0): Promise<CachableValue> {
    this.emit('set', key, value);

    if (value === undefined) {
      this.emit('warn', `Cannot set ${key} to undefined!`);
      return;
    }

    // The lru cache interprets 0 as no expiration date.
    if (ttl === 0) {
      this.cache.set(key, value);
    } else {
      this.cache.set(key, value, ttl * 1000);
    }
    return true;
  }

  /**
   * @inheritdoc
   */
  public async getValue(key: string): Promise<string> {
    const value = await this.cache.get(key);
    this.emit('get', key, value);
    return value;
  }

  /**
   * @inheritdoc
   */
  public async delValue(key: string): Promise<void> {
    this.cache.del(key);
  }

  public async clear(): Promise<void> {
    this.cache.reset();
  }

}
