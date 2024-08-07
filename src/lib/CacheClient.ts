import { CacheInstance, CachableValue } from './CacheInstance';

export abstract class CacheClient {

  protected cacheInstance: CacheInstance;
  protected buildCacheKey(propertyKey: string, args: any[]): string {

    const buildKeyArgs = (args: any[]) => args
      .filter(x =>
        typeof x !== 'object' ||
        // If the arg is an object, we check that it's not an instance of a class
        (typeof x === 'object' && (x?.constructor.name === 'Object' || x?.constructor.name === 'Array')) ||
        // typeof null === object, then we need to have another condition to accept null as well
        x === null
      ).map(x => {
        if (typeof x === 'object' && !Array.isArray(x) && x) {
          // Check if we have a circular reference in the plain object
          JSON.stringify(x);

          return Object.entries(x).sort().map(([key, value]) => {
            if (typeof value === 'object') {
              const nestedObjectKeys = buildKeyArgs([value])
              return `${key}-${nestedObjectKeys}`
            }
            return `${key}-${value}`
          }).join('-');
        }

        if (Array.isArray(x)) {
          const builtKey = buildKeyArgs(x.sort());
          return builtKey.join('-');
        }
        return new String(x).valueOf();
      });

    const builtKey = [
      propertyKey,
      ...buildKeyArgs(args),
    ].join('-');

    const maxKeyLength = process.env.UNITO_CACHE_MAX_KEY_LENGTH && parseInt(process.env.UNITO_CACHE_MAX_KEY_LENGTH, 10) || 1000;
    if (builtKey.length > maxKeyLength) {
      throw new Error(`Built key is bigger than ${maxKeyLength} chars`);
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

  // We *do* want a loosely-typed `Function` here, by nature of the library
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
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
   * Wait for the write commands to be acknowledged by the replicas.
   * This is useful when you want to ensure data is freshness on all nodes of the cluster.
   * We're defaulting to 5 replicas because it is the maximum number of read-only replica nodes
   * that you can have for each shard in AWS-Elastic cache (https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/Replication.Redis.Groups.html)
   * 
   * /!\ If the number of replicas asked for acknowledgment is greater than the number of replicas in the cluster, the function will always block
   * /!\ until the timeout is reached. Make sure you know the number of replicas in your cluster when calling this function.
   */
  public async waitForReplication(replicas: number = 5, timeout: number = 50): Promise<number> {
    return this.cacheInstance.waitForReplication(replicas, timeout);
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
