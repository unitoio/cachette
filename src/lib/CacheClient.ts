import { CacheInstance, CachableValue } from './CacheInstance';

export abstract class CacheClient {

  protected cacheInstance: CacheInstance;
  protected buildCacheKey(propertyKey: string, args: any[]): string {
    const keyParts = args
      .filter(x => x !== undefined && x !== null)
      .filter(x => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean')
      .map(x => x.toString());
    return [
      propertyKey,
      ...keyParts,
    ].join('-');
  }

  /**
   * Decorator to cache the calls to a function.
   */
  public static cached(ttl: number = 0): any {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
      const origFunction = descriptor.value;
      // don't use an => function here, or you lose access to 'this'
      const newFunction = function (...args): Promise<CachableValue> {
        const key = this.buildCacheKey(propertyKey, args);
        const fetchFunction = origFunction.bind(this, ...args);
        return this.cacheInstance.getOrFetchValue(key, ttl, fetchFunction);
      };
      descriptor.value = newFunction;
      return descriptor;
    };
  }

}
