import { LRUCache } from 'lru-cache';

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
  private cache = new LRUCache<string, any>({
    max: Number.parseInt(process.env.CACHETTE_LC_MAX_ITEMS as string, 10) || LocalCache.DEFAULT_MAX_ITEMS,
    ttl: Number.parseInt(process.env.CACHETTE_LC_MAX_AGE as string, 10) || LocalCache.DEFAULT_MAX_AGE,
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
    return this.cache.size;
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
      this.cache.set(key, value, { ttl: ttl * 1000 });
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
   * Return the number of ms left in the item's TTL.
   * If item is not in cache, returns 0.
   * Returns a very large number (e.g. 1799999.9158420563) if item is in cache without a defined TTL.
   * Docs: https://github.com/isaacs/node-lru-cache#getremainingttlkey
   */
  public async getTtl(key: string): Promise<number | undefined> {
    const remainingTtl = await this.cache.getRemainingTTL(key);
    /** If entry is not cached, return undefined */
    if (remainingTtl === 0) {
      return undefined;
    }
    /** If entry does not expire, return 0 */
    if (remainingTtl > 1799999) {
      return 0;
    }

    return remainingTtl;
  }

  /**
   * @inheritdoc
   */
  public async delValue(key: string): Promise<void> {
    this.cache.delete(key);
  }

  /**
   * @inheritdoc
   */
  public async waitForReplication(replicas: number, timeout: number): Promise<number> {
    return 0;
  }

  /**
   * @inheritdoc
   */
  public async clear(): Promise<void> {
    this.cache.clear();
  }

  /**
   * @inheritdoc
   */
  public async clearMemory(): Promise<void> {
    this.cache.clear();
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
      this.cache.purgeStale()
      if (!this.cache.has(resource)) {
        isLocked = false;
      } else {
        // LRU keeps its TTL information private, so we don't know how long to wait.
        // Whatever, we just loop on waiting a bit and retrying.
        await sleep(10);
      }
    }
    this.cache.set(resource, 1, { ttl: ttlMs });
    return new Promise(resolve => { resolve(resource) });
  }

  /**
   * @inheritdoc
   */
  public async unlock(lock: any): Promise<void> {
    this.cache.delete(lock);
    return new Promise(resolve => { resolve() });
  }

  /**
   * @inheritdoc
   *
   * Note that this specific implementation in `LocalCache` is not very efficient.
   * Use RedisCache for a performant implementation.
   */
  public async hasLock(prefix: string): Promise<boolean> {
    const startsWithPattern = prefix.replace(/\*$/, '');
    let found = false;
    this.cache.purgeStale();
    this.cache.forEach((value, key) => {
      // Doing a full CPU-inefficient traversal because `lru-cache.LRU` doesn't
      // provide a `some` function or a way to exit this `forEach`. An alternative
      // would be to work on `keys()`, which then would be RAM-inefficient.
      // Neither is a big deal, this cache is meant to be used for small local/dev
      // If this needs fixing, TODO move away from LRU.lru-cache.
      if (key.startsWith(startsWithPattern)) {
        found = true;
      }
    });
    return new Promise((resolve) => { resolve(found) });
  }

}
