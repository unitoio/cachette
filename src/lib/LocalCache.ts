import * as LRU from 'lru-cache';

import { CachableValue, CacheInstance } from './CacheInstance';


export class LocalCache extends CacheInstance {

  public static DEFAULT_MAX_ITEMS: number = 5000;
  // Default maximum age for the items, in MS.
  public static DEFAULT_MAX_AGE: number = 30 * 60 * 1000;

  // See https://github.com/isaacs/node-lru-cache#options
  // for options.
  private cache: any = new LRU({
    max: Number.parseInt(process.env.CACHETTE_LC_MAX_ITEMS as string, 10) || LocalCache.DEFAULT_MAX_ITEMS,
    maxAge: Number.parseInt(process.env.CACHETTE_LC_MAX_AGE as string, 10) || LocalCache.DEFAULT_MAX_AGE,
    stale: false,
  });

  /**
   * @inheritdoc
   */
  public async isReady(): Promise<void> {
    return;
  }

  /**
   * @inheritdoc
   */
  public async setValue(key: string, value: CachableValue, ttl: number = 0): Promise<boolean> {
    this.emit('set', key, value);

    if (value === undefined) {
      this.emit('warn', `Cannot set ${key} to undefined!`);
      return false;
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
  public async getTtl(key: string): Promise<number | undefined> {
    throw new Error('not implemented');
  }

  /**
   * @inheritdoc
   */
  public async delValue(key: string): Promise<void> {
    this.cache.del(key);
  }

  /**
   * @inheritdoc
   */
  public async clear(): Promise<void> {
    this.cache.reset();
  }

  /**
   * @inheritdoc
   */
  public async clearMemory(): Promise<void> {
    this.cache.reset();
  }

}
