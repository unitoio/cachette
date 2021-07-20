import { expect } from 'chai';
import { CacheClient } from '../src/lib/CacheClient';
import { LocalCache } from '../src/lib/LocalCache';


describe('CacheClient', () => {

  describe('decorator cached()', () => {

    interface Response {
      variant: string;
      value: number;
    }

    class MyClass extends CacheClient {
      numCalled = 0;

      cacheInstance = new LocalCache();

      @CacheClient.cached()
      async fetchSomething(variant: string): Promise<Response> {
        this.numCalled++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          variant: variant,
          value: 100 + parseInt(variant, 10),
        };
      }

      @CacheClient.cached() // default error-caching function: caches all errors
      async throwingMachine1(): Promise<string> {
        this.numCalled++;
        throw new Error('nope');
      }

      @CacheClient.cached(undefined, err => err['retryable'] === false) // custom error-caching function: caches only 'retryable' errors
      async throwingMachine2(): Promise<string> {
        this.numCalled++;
        // initially throws a retryable (to assert we don't cache),
        // then switch to a non-retryable (to assert we do cache from that point)
        if (this.numCalled > 1) {
          const nonRetryableError = new Error('nope');
          nonRetryableError['retryable'] = false;
          throw nonRetryableError;
        }
        throw new Error('nope');
      }

    }

    it ('1. provides an error-caching function that caches all errors by default, 2. cohabits with the non-caching function', async () => {
      const myObj = new MyClass();
      const myObjThrowingMachine1WithErrorCaching = myObj.getErrorCachingFunction('throwingMachine1');

      // 1. Initial calls with *NO* caching
      let didThrow1 = false;
      try {
        await myObj.throwingMachine1();
      } catch (err) {
        didThrow1 = true;
      }
      expect(didThrow1).to.be.true;
      expect(myObj.numCalled).to.equal(1); // initial call -> increase

      let didThrow2 = false;
      try {
        await myObj.throwingMachine1();
      } catch (err) {
        didThrow2 = true;
      }
      expect(didThrow2).to.be.true;
      expect(myObj.numCalled).to.equal(2); // no caching -> increase

      // 2. Interleaving calls *WITH* caching
      let didThrow3WithCaching = false;
      try {
        await myObjThrowingMachine1WithErrorCaching(true);
      } catch (err) {
        didThrow3WithCaching = true;
      }
      expect(didThrow3WithCaching).to.be.true;
      expect(myObj.numCalled).to.equal(3); // first call with caching -> increase

      let didThrow4WithCaching = false;
      try {
        await myObjThrowingMachine1WithErrorCaching(true);
      } catch (err) {
        didThrow4WithCaching = true;
      }
      expect(didThrow4WithCaching).to.be.true;
      expect(myObj.numCalled).to.equal(3); // second call with caching -> NO increase

      // 3. Back to calls with *NO* caching
      let didThrow5 = false;
      try {
        await myObj.throwingMachine1();
      } catch (err) {
        didThrow5 = true;
      }
      expect(didThrow5).to.be.true;
      expect(myObj.numCalled).to.equal(4); // back to no caching -> increase
    });

    it('honors the shouldCacheError callback letting users specify which errors to cache', async () => {
      const myObj = new MyClass();
      const myObjThrowingMachine2WithErrorCaching = myObj.getErrorCachingFunction('throwingMachine2');

      // 1. Initial call *WITH* caching, which will throw a retryable error (not cached)
      let didThrow1 = false;
      try {
        await myObjThrowingMachine2WithErrorCaching();
      } catch (err) {
        didThrow1 = true;
      }
      expect(didThrow1).to.be.true;
      expect(myObj.numCalled).to.equal(1); // initial call -> increase

      // 2. Second call *WITH* caching, which will this time throw a non-retryable error (cached)
      let didThrow2 = false;
      try {
        await myObjThrowingMachine2WithErrorCaching();
      } catch (err) {
        didThrow2 = true;
      }
      expect(didThrow2).to.be.true;
      expect(myObj.numCalled).to.equal(2); // it got called again -> increase

      // 3. Third call *WITH* caching, now fetched from cache
      let didThrow3 = false;
      try {
        await myObjThrowingMachine2WithErrorCaching();
      } catch (err) {
        didThrow3 = true;
      }
      expect(didThrow3).to.be.true;
      expect(myObj.numCalled).to.equal(2); // from cache -> NO increase
    });

    it('protect against concurrent fetches', async () => {
      const myObj = new MyClass();
      const jobs: Promise<any>[] = [];

      for (let i = 0; i < 100; i++) {
        const variant = i % 10;
        jobs.push(myObj.fetchSomething(variant.toString()));
      }

      const results = await Promise.all(jobs);
      let numSuccess = 0;
      results.forEach(x => {
        if (x.value === 100 + parseInt(x.variant, 10)) {
          numSuccess++;
        }
      });

      // Number time fetched
      expect(myObj.numCalled).to.eql(10);
      // Number successes
      expect(numSuccess).to.eql(100);
    });

    it('can use the uncached version of a cached function', async () => {
      const myObj = new MyClass();

      await myObj.fetchSomething('123');
      await myObj.fetchSomething('123');
      expect(myObj.numCalled).to.eql(1);

      await myObj.getUncachedFunction('fetchSomething')('123');
      expect(myObj.numCalled).to.eql(2);
    });

    it('can clear the value of a function that was cached using the decorator.', async () => {
      const myObj = new MyClass();

      await myObj.fetchSomething('123');
      expect(myObj.numCalled).to.eql(1);
      let cachedValue = await myObj.getCachedFunctionCall('fetchSomething', '123');
      expect(cachedValue).to.exist;

      await myObj.clearCachedFunctionCall('fetchSomething', '123');
      cachedValue = await myObj.getCachedFunctionCall('fetchSomething', '123');
      expect(cachedValue).not.to.exist;
    });

  });

  describe('buildCacheKey', () => {

    class MyCacheClient extends CacheClient {
      cacheInstance = new LocalCache();
    }

    it('will ignore null or undefined', async () => {

      const cacheClient = new MyCacheClient();
      const key = cacheClient['buildCacheKey']('functionName', [null, undefined, 'argument']);
      expect(key).to.equal('functionName-argument');

    });

    it('will convert boolean values', async () => {

      const cacheClient = new MyCacheClient();
      const key = cacheClient['buildCacheKey']('functionName', ['argument', true, 'argument', false]);
      expect(key).to.equal('functionName-argument-true-argument-false');

    });

    it('will convert number values', async () => {

      const cacheClient = new MyCacheClient();
      const key = cacheClient['buildCacheKey']('functionName', ['argument', 14, 'argument', 16]);
      expect(key).to.equal('functionName-argument-14-argument-16');

    });

    it('will convert plain object values', async () => {
      const cacheClient = new MyCacheClient();
      const expectedKey = 'functionName-argument-property1-prop1-property2-prop2-property3-nestedProp1-nestedProp1-nestedProp2-nestedProp2';

      const keyWithSortedObjectProperties = cacheClient['buildCacheKey']('functionName', [
        'argument',
        { property1: 'prop1', property2: 'prop2', property3: { nestedProp1: 'nestedProp1', nestedProp2: 'nestedProp2' } },
        new Date(),
      ]);
      expect(keyWithSortedObjectProperties).to.equal(expectedKey);
    })

    it('will convert plain object values and the result should be the same key if two objects have the same properties but not in the same order', async () => {
      const cacheClient = new MyCacheClient();

      const keyWithSortedObjectProperties = cacheClient['buildCacheKey']('functionName', [
        'argument',
        { property1: { nestedProp1: 'nestedProp1', nestedProp2: 'nestedProp2' }, property2: 'prop2' },
      ]);

      const keyWithUnsortedObjectProperties = cacheClient['buildCacheKey']('functionName', [
        'argument',
        { property2: 'prop2' , property1: { nestedProp1: 'nestedProp1', nestedProp2: 'nestedProp2' } },
        new Date(),
      ]);
      expect(keyWithUnsortedObjectProperties).to.equal(keyWithSortedObjectProperties);
    })
  });

});
