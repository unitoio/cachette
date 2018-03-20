import { CachableValue, CacheInstance } from './CacheInstance';
import { RedisCache } from './RedisCache';
import { LocalCache } from './LocalCache';


/**
 * Write-through cache, using Redis and a local LRU cache.
 */
export class WriteThroughCache extends CacheInstance {

  private redisCache: CacheInstance;
  private localCache: CacheInstance;

  constructor(redisUrl: string) {
    super();
    this.redisCache = new RedisCache(redisUrl);
    this.localCache = new LocalCache();
  }

  public on(eventName: string | symbol, listener: Function): this {
    this.redisCache.on(eventName, listener);
    this.localCache.on(eventName, listener);
    return this;
  }

  /**
   * @inheritdoc
   */
  public async setValue(
    key: string,
    value: CachableValue,
    ttl: number = 0,
  ): Promise<boolean> {
    const response = await this.localCache.setValue(key, value, ttl);
    return await this.redisCache.setValue(key, value, ttl) && response;
  }

  /**
   * @inheritdoc
   */
  public async getValue(key: string): Promise<CachableValue> {
    const localValue = await this.localCache.getValue(key);
    if (localValue !== undefined) {
      return localValue;
    }
    const redisValue = await this.redisCache.getValue(key);
    if (redisValue !== undefined) {
      await this.localCache.setValue(key, redisValue, 120);
    }
    return redisValue;
  }

  /**
   * @inheritdoc
   */
  public async delValue(key: string): Promise<void> {
    this.emit('del', key);
    await this.localCache.delValue(key);
    await this.redisCache.delValue(key);
  }

}
