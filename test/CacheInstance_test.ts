import { expect } from 'chai';
import * as sinon from 'sinon';

import { LocalCache } from '../src/lib/LocalCache';
import { RedisCache } from '../src/lib/RedisCache';
import { WriteThroughCache } from '../src/lib/WriteThroughCache';
import { CacheInstance, FetchingFunction } from '../src/lib/CacheInstance';


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
      lockSpy.reset();
      unlockSpy.reset();
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
      const fetchFunction = object.fetch.bind(object, 'newvalue');
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
