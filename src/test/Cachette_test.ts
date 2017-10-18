
require('source-map-support').install();

import 'mocha';
import { expect } from 'chai';
import * as sinon from 'sinon';
import * as redis from 'redis';
import { EventEmitter } from 'events';

import { Cachette, fetchingFunction } from '../lib/Cachette';
import { LocalCache } from '../lib/LocalCache';
import { RedisCache } from '../lib/RedisCache';


/**
 * a simple Redis stub used in tests
 */
class RedisClientStub extends EventEmitter {
  setAsync(_key, _value, _rest): Promise<string> {
    return Promise.resolve('OK');
  }
}


describe('Cachette', () => {
  describe('fallback', () => {

    afterEach(() => Cachette.disconnect());

    it('will fallback to using a local cache is no connection is made', () => {

      Cachette.connect('redis://localhost:9999');

      const cacheInstance = Cachette.getCacheInstance();
      expect(cacheInstance instanceof LocalCache).to.be.true;

    });

    it('will create a local cache if connect was not called', () => {
      const cacheInstance = Cachette.getCacheInstance();
      expect(cacheInstance instanceof LocalCache).to.be.true;
    });

    it('will fallback to using a local cache when connection is lost, then reconnect when it is back', async () => {

      let stub;
      try {
        const redisClientStub = new RedisClientStub();
        stub = sinon.stub(redis, 'createClient', () => {
          return redisClientStub;
        });
        Cachette.connect('redis://localhost:9999');

        // redis ready
        redisClientStub.emit('connect');
        expect(Cachette.getCacheInstance() instanceof RedisCache).to.be.true;

        // fail over
        redisClientStub.emit('end');
        expect(Cachette.getCacheInstance() instanceof LocalCache).to.be.true;

        // reconnect
        redisClientStub.emit('connect');
        expect(Cachette.getCacheInstance() instanceof RedisCache).to.be.true;

        // error
        redisClientStub.emit('end');
        expect(Cachette.getCacheInstance() instanceof LocalCache).to.be.true;

        // reconnect
        redisClientStub.emit('connect');
        expect(Cachette.getCacheInstance() instanceof RedisCache).to.be.true;

      } finally {
        if (stub) {
          stub.restore();
        }
      }

    });

    it('will not crash the application given an invalid Redis URL without protocol', () => {
      Cachette.connect('rer17kq3qdwc5wmy.4gzf3f.ng.0001.use1.cache.amazonaws.com');
      const cacheInstance = Cachette.getCacheInstance();
      expect(cacheInstance instanceof LocalCache).to.be.true;
    });

  });

  describe('getOrFetchValue', () => {

    beforeEach(() => Cachette.connect());
    afterEach(() => Cachette.disconnect());

    it('does not fetch if value in cache', async () => {
      let numCalled = 0;
      const object = {
        fetch: async (value) => {
          numCalled++;
          return value;
        },
      };

      const cache = Cachette.getCacheInstance();
      cache.setValue('key', 'value');
      const value = await Cachette.getOrFetchValue(
        'key',
        10,
        false,
        <fetchingFunction> object.fetch,
        object,
        'newvalue',
      );
      expect(value).to.eql('value');
      expect(numCalled).to.eql(0);

    });

    it('fetches if value not in cache', async () => {
      let numCalled = 0;
      const object = {
        fetch: async (value) => {
          numCalled++;
          return value;
        },
      };

      const cache = Cachette.getCacheInstance();
      cache.setValue('key2', 'value');
      const value = await Cachette.getOrFetchValue(
        'key',
        10,
        false,
        <fetchingFunction> object.fetch,
        object,
        'newvalue',
      );
      expect(value).to.eql('newvalue');
      expect(numCalled).to.eql(1);

    });

    it('fetches once if multiple simultaneous requests', async () => {
      let numCalled = 0;
      const object = {
        fetch: async (value) => {
          numCalled++;
          return value;
        },
      };

      const cache = Cachette.getCacheInstance();
      cache.setValue('key2', 'value');

      const callGetOrFetch = () => Cachette.getOrFetchValue(
        'key',
        10,
        false,
        <fetchingFunction> object.fetch,
        object,
        'newvalue',
      );

      const calls = [];
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

      const callGetOrFetch = (key, fn) => Cachette.getOrFetchValue(
        key,
        10,
        false,
        fn,
        object,
        'newvalue',
      );

      const calls = [];

      for (let i = 0; i < 100; i++) {
        const fn = (i % 2) ? object.fetch1 : object.fetch2;
        const key = (i % 2) ? 'key1' : 'key2';
        calls.push(callGetOrFetch(key, fn as fetchingFunction));
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

      const callGetOrFetch = () => Cachette.getOrFetchValue(
        'key',
        10,
        false,
          <fetchingFunction> object.fetch,
        object,
        'newvalue',
      );

      const calls = [];
      for (let i = 0; i < 10; i++) {
        calls.push(callGetOrFetch());
      }

      let numExceptions = 0;
      for (const call of calls) {
        await call.catch(() => numExceptions++);
      }

      expect(numExceptions).to.eql(10);

    });

  });

  describe('decorator cached()', () => {

    beforeEach(() => Cachette.connect());
    afterEach(() => Cachette.disconnect());

    interface Response {
      variant: string;
      value: number;
    }

    class MyClass {
      numCalled: number = 0;

      buildCacheKey(functionName: string, args: string[]): string {
        return [
          functionName,
          ...args,
        ].join('-');
      }

      @Cachette.cached()
      async fetchSomething(variant: string): Promise<Response> {
        this.numCalled++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          variant: variant,
          value: 100 + parseInt(variant, 10),
        };
      }
    }

    it('protect against concurrent fetches', async () => {
      const myObj = new MyClass();
      const jobs = [];

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

  });

});
