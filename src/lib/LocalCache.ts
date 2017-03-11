const LRU = require('lru-cache');

import { cachableValue, CacheInstance } from './CacheInstance';
import { Cachette } from './Cachette';


export class LocalCache extends CacheInstance {

  public static MAXIMUM_CACHE_SIZE: number = 5000;

  private cache: any = LRU({
    max: LocalCache.MAXIMUM_CACHE_SIZE,
    stale: false,
  });

  /**
   * @inheritdoc
   */
  public setValue(key: string, value: cachableValue, ttl: number = 0, overwrite: boolean = true): Promise<boolean> {
    Cachette.logger.debug(`Setting ${key} to`, value);

    if (value === undefined) {
      Cachette.logger.warn(`Cannot set ${key} to undefined!`);
      return;
    }

    if (overwrite || !this.cache.has(key)) {
      // The lru cache interprets 0 as no expiration date.
      if (ttl === 0) {
        this.cache.set(key, value);
      } else {
        this.cache.set(key, value, ttl * 1000);
      }
      return Promise.resolve(true);
    }

    return Promise.resolve(false);
  }

  /**
   * @inheritdoc
   */
  public async getValue(key: string): Promise<string> {
    const value = await this.cache.get(key);
    Cachette.logger.debug(`Getting ${key} : `, value);
    return Promise.resolve(value);
  }

}
