import { CacheInstance, CachableValue } from './CacheInstance';

export abstract class CacheClient {

  protected cacheInstance: CacheInstance;
  protected buildCacheKey(propertyKey: string, args: any[]): string {

    const buildKeyArgs = (args: any[]) => args
      .filter(x =>
        typeof x !== 'object' ||
        // If the arg is an object, we check that it's not a instance of a class
        (typeof x === 'object' && (x?.constructor.name === 'Object' || x?.constructor.name === 'Array')) ||
        // typeof null === object, then we need to have another condition to accept null as well
        x === null
      ).map(x => {
        if (typeof x === 'object' && !Array.isArray(x) && x) {
          return Object.entries(x).sort().map(([key, value]) => {
            if (typeof value === 'object') {
              const nestedObjectKeys = buildKeyArgs([value])
              return `${key}-${nestedObjectKeys}`
            }
            return `${key}-${value}`
          }).join('-');
        }

        if (Array.isArray(x)) {
          return x.sort().join('-');
        }
        return new String(x).valueOf();
      });

    const builtKey = [
      propertyKey,
      ...buildKeyArgs(args),
    ].join('-');

    if (builtKey.length > 1000) {
      throw new Error('Built key is bigger than 1000 chars');
    }

    return builtKey;
  }

  /**
   * Decorator to cache the calls to a function.
   *
   * @param ttl How long the cache should last, in seconds
   * @param shouldCacheError How the error-caching function (accessible by calling
   *        `getErrorCachingFunction`) should decide which errors to cache.
   *        Defaults to caching *all* errors. *Again, to insist*: this does not
   *        mean the _decorated function_ will cache all errors, it means that
   *        _the error-caching function_ will. They live apart and each honors
   *        its behavior (decorated function *never* caches errors, the other does)
   */
  public static cached(
    ttl = 0,
    shouldCacheError = (err: Error) => true,
  ): any {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
      const origFunction = descriptor.value;

      // don't use an => function here, or you lose access to 'this'
      const functionCachingResults = function (...args): Promise<CachableValue> {
        const key = this.buildCacheKey(propertyKey, args);
        const fetchFunction = origFunction.bind(this, ...args);
        return this.cacheInstance.getOrFetchValue(
          key,
          ttl,
          fetchFunction,
          undefined,
        );
      };
      const functionCachingResultsAndErrors = function (...args): Promise<CachableValue> {
        const key = this.buildCacheKey(propertyKey, args);
        const fetchFunction = origFunction.bind(this, ...args);
        return this.cacheInstance.getOrFetchValue(
          key,
          ttl,
          fetchFunction,
          undefined,
          shouldCacheError,
        );
      };

      target[`${propertyKey}NoCache`] = origFunction;
      target[`${propertyKey}ErrorCaching`] = functionCachingResultsAndErrors;

      descriptor.value = functionCachingResults;
      return descriptor;
    };
  }

  // We *do* want an loosely-typed `Function` here, by nature of the library
  // eslint-disable-next-line @typescript-eslint/ban-types
  public getUncachedFunction(functionName: string): Function {
    if (this[`${functionName}NoCache`]) {
      return this[`${functionName}NoCache`].bind(this);
    }
    return this[functionName].bind(this);
  }

  public getErrorCachingFunction(functionName: string): (...args: any) => Promise<any> {
    if (this[`${functionName}ErrorCaching`]) {
      return this[`${functionName}ErrorCaching`].bind(this);
    }
    return this[functionName].bind(this);
  }

  /**
   * Clears the valued returned from a cached function call,
   * using the CacheClient.cached.
   */
  public async clearCachedFunctionCall(functionName: string, ...args: any[]): Promise<void> {
    const key = this.buildCacheKey(functionName, args);
    await this.cacheInstance.delValue(key);
  }

  /**
   * Gets the valued returned from a cached function call,
   * using the CacheClient.cached.
   */
  public async getCachedFunctionCall(functionName: string, ...args: any[]): Promise<CachableValue> {
    const key = this.buildCacheKey(functionName, args);
    return this.cacheInstance.getValue(key);
  }

}
