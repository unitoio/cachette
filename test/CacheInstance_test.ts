import { expect } from 'chai';
import * as sinon from 'sinon';

import { LocalCache } from '../src/lib/LocalCache';
import { RedisCache } from '../src/lib/RedisCache';
import { WriteThroughCache } from '../src/lib/WriteThroughCache';
import { CacheInstance, FetchingFunction } from '../src/lib/CacheInstance';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// set env var TEST_REDIS_URL (e.g. redis://localhost:6379) to enable running
// the tests with Redis

describe('CacheInstance', () => {

  runTests('local', new LocalCache());

  if (process.env.TEST_REDIS_URL) {
    const redisCache = new RedisCache(process.env.TEST_REDIS_URL);
    runTests('redis', redisCache);

    const writeThroughCache = new WriteThroughCache(process.env.TEST_REDIS_URL);
    runTests('writeThrough', writeThroughCache);
  }

});

function runTests(name: string, cache: CacheInstance): void {

  const lockSupported = cache.isLockingSupported();
  const ifLockIt = (cache && cache.isLockingSupported()) ? it : it.skip;
  let lockSpy: sinon.SinonSpy;
  let unlockSpy: sinon.SinonSpy;

  before(() => {
    if (lockSupported) {
      lockSpy = sinon.spy(cache, 'lock');
      unlockSpy = sinon.spy(cache, 'unlock');
    }
  });

  beforeEach(() => {
    if (lockSupported) {
      lockSpy.resetHistory();
      unlockSpy.resetHistory();
    }
  });

  after(() => {
    if (lockSpy) {
      lockSpy.restore();
    }
    if (unlockSpy) {
      unlockSpy.restore();
    }
  });


  describe(`getOrFetchValue - ${name}`, () => {

    beforeEach(() => cache.clear());

    it('does not fetch if value in cache', async () => {
      const key = `key${Math.random()}`;
      let numCalled = 0;
      const object = {
        fetch: async (v) => {
          numCalled++;
          return v;
        },
      };

      await cache.setValue(key, 'value');
      const fetchFunction: () => Promise<string> = object.fetch.bind(object, 'newvalue');
      const value = await cache.getOrFetchValue(key, 10, fetchFunction);
      expect(value).to.eql('value');
      expect(numCalled).to.eql(0);
      if (lockSupported) {
        sinon.assert.notCalled(lockSpy);
        sinon.assert.notCalled(unlockSpy);
      }
    });

    it('fetches if value not in cache', async () => {
      let numCalled = 0;
      const object = {
        fetch: async (v) => {
          numCalled++;
          return v;
        },
      };

      await cache.setValue('key2', 'value');
      const fetchFunction = object.fetch.bind(object, 'newvalue');
      const value = await cache.getOrFetchValue(
        'key',
        10,
        fetchFunction,
      );
      expect(value).to.eql('newvalue');
      expect(numCalled).to.eql(1);
      if (lockSupported) {
        sinon.assert.notCalled(lockSpy);
        sinon.assert.notCalled(unlockSpy);
      }
    });

    it('does not cache exceptions by default', async () => {
      let numCalled = 0;
      const object = {
        fetchThatThrows: async () => {
          numCalled++;
          throw new Error(`nope ${numCalled}`);
        },
      };

      const fetchFunction = object.fetchThatThrows.bind(object, 'newvalue');
      try {
        await cache.getOrFetchValue('key', 10, fetchFunction);
      } catch (err) {
        expect(err.message).to.equal('nope 1');
      }
      expect(numCalled).to.equal(1);

      try {
        await cache.getOrFetchValue('key', 10, fetchFunction);
      } catch (err) {
        expect(err.message).to.equal('nope 2'); // <- no caching happened
      }
      expect(numCalled).to.equal(2);
    });

    it('caches exceptions if asked to', async () => {
      let numCalled = 0;
      const object = {
        fetchThatThrows: async () => {
          numCalled++;
          const error = new Error(`nope ${numCalled}`);
          error.name = 'MyCustomError';
          // Some people enrich their errors objects with metadata.
          // We ensure to preserve these.
          error['myStringProperty'] = 'foo';
          error['myBooleanProperty'] = true;
          error['myNumberProperty'] = 1789.1789;
          throw error;
        },
      };
      const fetchFunction = object.fetchThatThrows.bind(object, 'newvalue');

      let didThrow = false;
      const getFromCache = async () => cache.getOrFetchValue('key', 10, fetchFunction, undefined, () => true);
      try {
        await getFromCache();
      } catch (err) {
        // initial throw, without cache
        didThrow = true;
        expect(err.message).to.equal('nope 1');
        expect(err.name).to.equal('MyCustomError');
        expect(err.myStringProperty).to.equal('foo');
        expect(err.myBooleanProperty).to.equal(true);
        expect(err.myNumberProperty).to.equal(1789.1789);
      }
      expect(didThrow).to.be.true;
      expect(numCalled).to.equal(1);

      didThrow = false;
      try {
        await getFromCache();
      } catch (err) {
        // second throw, cached
        didThrow = true;
        expect(err.message).to.equal('nope 1'); // <-- from cache; didn't increase
        expect(err.name).to.equal('MyCustomError');
        expect(err.myStringProperty).to.equal('foo');
        expect(err.myBooleanProperty).to.equal(true);
        expect(err.myNumberProperty).to.equal(1789.1789);
      }
      expect(didThrow).to.be.true;
      expect(numCalled).to.equal(1); // <-- from cache; didn't increase
    });

    it('honors the shouldCacheError callback to determine whether to cache or not to cache -- (?, that is the question)', async () => {
      let numCalled = 0;
      const object = {
        fetchThatThrowsAfterThree: async () => {
          numCalled++;
          const error = new Error(`nope ${numCalled}`);
          error.name = numCalled >= 3 ? 'CacheableError' : 'NonCacheableError';
          throw error;
        },
      };
      const fetchFunction = object.fetchThatThrowsAfterThree.bind(object, 'newvalue');

      let didThrow = false;
      const getFromCache = async () => cache.getOrFetchValue(
        'key',
        10,
        fetchFunction,
        undefined,
        (err) => err.name !== 'NonCacheableError',
      );
      try {
        await getFromCache();
      } catch (err) {
        didThrow = true;
        expect(err.message).to.equal('nope 1');
        expect(err.name).to.equal('NonCacheableError');
      }
      expect(didThrow).to.be.true;
      expect(numCalled).to.equal(1);

      didThrow = false;
      try {
        await getFromCache();
      } catch (err) {
        didThrow = true;
        expect(err.message).to.equal('nope 2');
        expect(err.name).to.equal('NonCacheableError');
      }
      expect(didThrow).to.be.true;
      expect(numCalled).to.equal(2); // <-- from actuall call, did increase

      // next calls (after third call) will produce a cacheable error
      didThrow = false;
      try {
        await getFromCache();
      } catch (err) {
        didThrow = true;
        expect(err.message).to.equal('nope 3');
        expect(err.name).to.equal('CacheableError');
      }
      expect(didThrow).to.be.true;
      expect(numCalled).to.equal(3); // <-- from actual call, did increase

      didThrow = false;
      try {
        await getFromCache();
      } catch (err) {
        didThrow = true;
        expect(err.message).to.equal('nope 3');
        expect(err.name).to.equal('CacheableError');
      }
      expect(didThrow).to.be.true;
      expect(numCalled).to.equal(3); // <-- from cache, didn't increase
    });

    it('fetches once if multiple simultaneous requests', async () => {
      let numCalled = 0;
      const object = {
        fetch: async (value) => {
          numCalled++;
          return value;
        },
      };

      await cache.setValue('key2', 'value');

      const fetchFunction = object.fetch.bind(object, 'newvalue');
      const callGetOrFetch = () => cache.getOrFetchValue(
        'key',
        10,
        fetchFunction,
      );

      const calls: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        calls.push(callGetOrFetch());
      }

      const values = await Promise.all(calls);
      expect(values.length).to.eql(100);
      for (const value of values) {
        expect(value).to.eql('newvalue');
      }
      expect(numCalled).to.eql(1);
    });

    it('fetches once each if multiple simultaneous of two requests', async () => {
      let numCalled1 = 0;
      let numCalled2 = 0;
      const object = {
        fetch1: async (value) => {
          numCalled1++;
          return value;
        },
        fetch2: async (value) => {
          numCalled2++;
          return `${value}bis`;
        },
      };

      const callGetOrFetch = (key, fn) => {
        const fetchFunction = fn.bind(object, 'newvalue');
        return cache.getOrFetchValue(
          key,
          10,
          fetchFunction,
        );
      };

      const calls: Promise<any>[] = [];

      for (let i = 0; i < 100; i++) {
        const fn = (i % 2) ? object.fetch1 : object.fetch2;
        const key = (i % 2) ? 'key1' : 'key2';
        calls.push(callGetOrFetch(key, fn as FetchingFunction));
      }

      const values = await Promise.all(calls);
      expect(values.length).to.eql(100);
      let count1 = 0;
      let count2 = 0;
      for (const value of values) {
        if (value === 'newvalue') {
          count1++;
        } else if (value === 'newvaluebis') {
          count2++;
        } else {
          expect(value).to.eql('newvalue');
        }
      }
      expect(numCalled1).to.eql(1);
      expect(numCalled2).to.eql(1);
      expect(count1).to.eql(50);
      expect(count2).to.eql(50);
    });

    it('handles errors during simultaneous requests', async () => {
      const object = {
        fetch: async (): Promise<number> => {
          throw new Error('basta');
        },
      };

      const callGetOrFetch = () => cache.getOrFetchValue(
        'key',
        10,
        object.fetch,
      );

      const calls: Promise<any>[] = [];
      for (let i = 0; i < 10; i++) {
        calls.push(callGetOrFetch());
      }

      let numExceptions = 0;
      for (const call of calls) {
        await call.catch(() => numExceptions++);
      }

      expect(numExceptions).to.eql(10);
    });

    ifLockIt('creates locks that expire', async () => {
      const prefix = `prefix_${Math.random()}`;
      await cache.lock(`${prefix}_sublock1`, 50);
      const locksExist = await cache.hasLock(prefix);
      expect(locksExist).to.be.true;

      await sleep(51);
      const locksExistAfterSleeping = await cache.hasLock(prefix);
      expect(locksExistAfterSleeping).to.be.false;
    });

    ifLockIt('waits for expiry of existing locks', async () => {
      const key = `prefix_${Math.random()}`;
      const timeBeforeFirstLock = Date.now();
      const firstLockTTL = 50;
      await cache.lock(key, firstLockTTL);
      const locksExist = await cache.hasLock(key);
      expect(locksExist).to.be.true;

      await cache.lock(key, 1000);
      const timeAfterFirstLock = Date.now();
      const locksStillExist = await cache.hasLock(key);
      expect(locksStillExist).to.be.true;

      expect(timeAfterFirstLock - timeBeforeFirstLock).to.be.greaterThanOrEqual(firstLockTTL);
    });

    ifLockIt('finds no lock if pattern does not match', async () => {
      await cache.lock(`lock__${Math.random()}`, 10000);
      await cache.lock(`otherlock__${Math.random()}`, 10000);

      const locksExist = await cache.hasLock('whatever');
      expect(locksExist).to.be.false;
    });

    ifLockIt('finds locks if a lock matches pattern', async () => {
      const prefix = `prefix_${Math.random()}`;
      await cache.lock(`${prefix}_sublock1`, 10000);

      const locksExist = await cache.hasLock(prefix);
      expect(locksExist).to.be.true;
    });

    ifLockIt('finds locks if a lock matches pattern, with already a star at the end', async () => {
      const prefix = `prefix_${Math.random()}`;
      await cache.lock(`${prefix}_sublock1`, 10000);

      const locksExist = await cache.hasLock(`${prefix}*`);
      expect(locksExist).to.be.true;
    });

    ifLockIt('finds no lock if a lock matched pattern, but was unlocked', async () => {
      const prefix = `prefix_${Math.random()}`;
      const lock = await cache.lock(`${prefix}_sublock1`, 10000);
      await cache.unlock(lock);

      const locksExist = await cache.hasLock(prefix);
      expect(locksExist).to.be.false;
    });

    ifLockIt('finds locks if several locks match pattern', async () => {
      const prefix = `prefix_${Math.random()}`;
      await cache.lock(`${prefix}_sublock1`, 10000);
      await cache.lock(`${prefix}_sublock2`, 10000);

      const locksExist = await cache.hasLock(prefix);
      expect(locksExist).to.be.true;
    });

    ifLockIt('returns no locks only when all the matching locks are cleared', async () => {
      const prefix = `prefix_${Math.random()}`;
      const lock1 = await cache.lock(`${prefix}_sublock1`, 10000);
      expect(await cache.hasLock(prefix)).to.be.true;

      const lock2 = await cache.lock(`${prefix}_sublock2`, 10000);
      expect(await cache.hasLock(prefix)).to.be.true;

      await cache.unlock(lock1);
      expect(await cache.hasLock(prefix)).to.be.true;

      await cache.unlock(lock2);
      expect(await cache.hasLock(prefix)).to.be.false;
    });

    ifLockIt('locks before fetching if value not in cache', async () => {
      const key = `key${Math.random()}`;
      let numCalled = 0;
      const object = {
        fetch: async (v) => {
          numCalled++;
          return v;
        },
      };

      const fetchFunction = object.fetch.bind(object, 'newvalue');
      const value = await cache.getOrFetchValue(key, 10, fetchFunction, 1);  // enable locking

      expect(value).to.eql('newvalue');
      expect(numCalled).to.eql(1);
      sinon.assert.calledOnce(lockSpy);
      sinon.assert.calledOnce(unlockSpy);
    });

    ifLockIt('does not fetch if value already in cache after lock', async () => {
      const key = `key${Math.random()}`;
      // steal the lock
      const lock = await cache.lock(`lock__${key}`, 1000);

      let numCalled = 0;
      const object = {
        fetch: async (v) => {
          numCalled++;
          return v;
        },
      };

      const fetchFunction = object.fetch.bind(object, 'newvalue');

      setTimeout(async () => {
        await cache.setValue(key, 'abcd');
        await cache.unlock(lock);
      }, 40);
      const value = await cache.getOrFetchValue(key, 10, fetchFunction, 1);

      expect(value).to.eql('abcd');
      expect(numCalled).to.eql(0);
      sinon.assert.calledTwice(lockSpy);   // includes our own call above
      sinon.assert.calledTwice(unlockSpy);
    });

  });

}
