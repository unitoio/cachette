import { CachableValue, CacheInstance } from './CacheInstance';
import { RedisCache } from './RedisCache';
import { LocalCache } from './LocalCache';


/**
 * Write-through cache, using Redis and a local LRU cache.
 */
export class WriteThroughCache extends CacheInstance {

  private redisCacheForWriting: CacheInstance;
  private redisCacheForReading: CacheInstance;
  private localCache: CacheInstance;

  private metrics: {
    enabled: boolean;
    localHits: number;
    redisHits: number;
    doubleMisses: number;
  };

  constructor(redisUrl: string) {
    super();
    this.redisCacheForWriting = new RedisCache(redisUrl);
    this.redisCacheForReading = new RedisCache(redisUrl, true);
    this.localCache = new LocalCache();

    this.metrics = {
      enabled: false,
      localHits: 0,
      redisHits: 0,
      doubleMisses: 0,
    };
    if (process.env.CACHETTE_METRICS_PERIOD_MINUTES) {
      const metricsPeriod = parseInt(process.env.CACHETTE_METRICS_PERIOD_MINUTES, 10);
      if (Number.isInteger(metricsPeriod) && metricsPeriod > 0) {
        this.metrics.enabled = true;
        this.redisCacheForWriting.emit('info', `WriteThroughCache metrics enabled, will report every ${metricsPeriod} min`);
        setInterval(() => {
          const total = this.metrics.localHits + this.metrics.redisHits + this.metrics.doubleMisses;
          this.redisCacheForWriting.emit(
            'info',
            `WriteThroughCache metrics during last ${metricsPeriod} min - Total: ${total}, ` +
            `Local hits: ${this.metrics.localHits} (${total && Math.floor(100 * this.metrics.localHits / total)}%), ` +
            `Redis hits: ${this.metrics.redisHits} (${total && Math.floor(100 * this.metrics.redisHits / total)}%), ` +
            `Double misses: ${this.metrics.doubleMisses} (${total && Math.floor(100 * this.metrics.doubleMisses / total)}%).`,
          );

          this.metrics.localHits = 0;
          this.metrics.redisHits = 0;
          this.metrics.doubleMisses = 0;
        }, metricsPeriod * 60 * 1000);
      } else {
        this.redisCacheForWriting.emit(
          'warn',
          'WriteThroughCache metrics activation impossible, CACHETTE_METRICS_PERIOD_MINUTES is invalid. ' +
          `Must be a positive integer, but was ${process.env.CACHETTE_METRICS_PERIOD_MINUTES}`);
      }
    }
  }

  public on(eventName: string | symbol, listener: (...args: any[]) => void): this {
    this.redisCacheForWriting.on(eventName, listener);
    this.redisCacheForReading.on(eventName, listener);
    this.localCache.on(eventName, listener);
    return this;
  }

  /**
   * @inheritdoc
   */
  public async isReady(): Promise<any> {
    return Promise.all([this.redisCacheForWriting.isReady(), this.redisCacheForReading.isReady()]);
  }

  /**
   * @inheritdoc
   */
  public async itemCount(): Promise<number> {
    return await this.redisCacheForReading.itemCount() + await this.localCache.itemCount();
  }

  /**
   * @inheritdoc
   */
  public async setValue(
    key: string,
    value: CachableValue,
    ttl = 0,
  ): Promise<boolean> {
    const response = await this.localCache.setValue(key, value, ttl);
    return await this.redisCacheForWriting.setValue(key, value, ttl) && response;
  }

  /**
   * @inheritdoc
   */
  public async getValue(key: string): Promise<CachableValue> {
    const localValue = await this.localCache.getValue(key);
    if (localValue !== undefined) {
      if (this.metrics.enabled) {
        this.metrics.localHits++;
      }
      return localValue;
    }
    const [redisValue, ttl] = await Promise.all([
      this.redisCacheForReading.getValue(key),
      this.redisCacheForWriting.getTtl(key),
    ]);

    if (redisValue !== undefined && ttl !== undefined) {
      await this.localCache.setValue(key, redisValue, ttl / 1000);
      if (this.metrics.enabled) {
        this.metrics.redisHits++;
      }
      return redisValue;
    }

    if (this.metrics.enabled) {
      this.metrics.doubleMisses++;
    }
    return redisValue;
  }

  /**
   * @inheritdoc
   */
  public async getTtl(key: string): Promise<number | undefined> {
    return this.redisCacheForWriting.getTtl(key);
  }

  /**
   * @inheritdoc
   */
  public async delValue(key: string): Promise<void> {
    this.emit('del', key);
    await this.localCache.delValue(key);
    await this.redisCacheForWriting.delValue(key);
  }

  /**
   * @inheritdoc
   */
  public async waitForReplication(replicas: number, timeout: number): Promise<number> {
    this.emit('wait')
    await this.localCache.waitForReplication(replicas, timeout);
    return this.redisCacheForWriting.waitForReplication(replicas, timeout);
  }

  /**
   * @inheritdoc
   */
  public async clear(): Promise<void> {
    await this.localCache.clear();
    await this.redisCacheForWriting.clear();
  }

  /**
   * @inheritdoc
   */
  public async clearMemory(): Promise<void> {
    await this.localCache.clearMemory();
    await this.redisCacheForWriting.clearMemory();
  }

  /**
   * @inheritdoc
   * Locking is *not* supported by the Write-Through cache. You want either:
   * - The full-fledged RedisCache for prod workloads
   * - A dumb LocalCache for dev/local workloads
   */
  public isLockingSupported(): boolean {
    return false;
  }

}
