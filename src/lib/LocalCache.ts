import * as LRU from 'lru-cache';

import { CachableValue, CacheInstance } from './CacheInstance';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class LocalCache extends CacheInstance {

  public static DEFAULT_MAX_ITEMS = 5000;
  // Default maximum age for the items, in MS.
  public static DEFAULT_MAX_AGE: number = 30 * 60 * 1000;

  public static LOCK_ACQUIRE_TIMEOUT = 2000;

  // See https://github.com/isaacs/node-lru-cache#options
  // for options.
  private cache = new LRU({
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
  public async itemCount(): Promise<number> {
    return this.cache.itemCount;
  }

  /**
   * @inheritdoc
   */
  public async setValue(key: string, value: CachableValue, ttl = 0): Promise<boolean> {
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
  public async getValue(key: string): Promise<any> {
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

  /**
   * @inheritdoc
   * Dumb locking is supported for local development work
   */
  public isLockingSupported(): boolean {
    return true;
  }

  /**
   * @inheritdoc
   */
  public async lock(resource: string, ttlMs: number): Promise<any> {
    let isLocked = true;
    const startTimestamp = Date.now()
    while(isLocked) {
      if (Date.now() - startTimestamp > LocalCache.LOCK_ACQUIRE_TIMEOUT) {
        throw new Error(`Abandoning locking ${resource} , as timed out while waiting for other lock to be released.`)
      }
      this.cache.prune()
      if (!this.cache.has(resource)) {
        isLocked = false;
      } else {
        // LRU keeps its TTL information private, so we don't know how long to wait.
        // Whatever, we just loop on waiting a bit and retrying.
        await sleep(10);
      }
    }
    this.cache.set(resource, 1, ttlMs);
    return new Promise(resolve => { resolve(resource) });
  }

  /**
   * @inheritdoc
   */
  public async unlock(lock: any): Promise<void> {
    this.cache.del(lock);
    return new Promise(resolve => { resolve() });
  }

  /**
   * @inheritdoc
   */
  public async hasLock(prefix: string): Promise<boolean> {
    const startsWithPattern = prefix.replace(/\*$/, '');
    let found = false;
    this.cache.prune();
    this.cache.forEach((value, key) => {
      if (typeof key === 'string' && key.startsWith(startsWithPattern)) {
        found = true;
      }
    });
    return new Promise((resolve) => { resolve(found) });
  }

}
