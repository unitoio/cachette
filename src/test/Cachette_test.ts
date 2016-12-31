
require('source-map-support').install();

import 'mocha';
import { expect } from 'chai';
import * as sinon from 'sinon';
import * as redis from 'redis';
import { EventEmitter } from 'events';

import { Cachette } from '../lib/Cachette';
import { LocalCache } from '../lib/LocalCache';
import { RedisCache } from '../lib/RedisCache';

process.env.LOG_LEVEL = 'disabled';


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

    afterEach(() => {
      Cachette.disconnect();
    });

    it('will fallback to using a local cache is no connection is made', () => {

      process.env.CACHE_URL = 'redis://localhost:9999';
      Cachette.connect();

      const cacheInstance = Cachette.getCacheInstance();
      expect(cacheInstance instanceof LocalCache).to.be.true;

      process.env.CACHE_URL = undefined;

    });

    it('will fallback to using a local cache when connection is lost, then reconnect when it is back', async () => {

      let stub;
      try {
        const redisClientStub = new RedisClientStub();
        stub = sinon.stub(redis, 'createClient', () => {
          return redisClientStub;
        });
        process.env.CACHE_URL = 'redis://localhost:9999';
        Cachette.connect();

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
        process.env.CACHE_URL = undefined;
      }

    });

    it('will not crash the application given an invalid Redis URL without protocol', () => {

      process.env.REDIS_URL = 'rer17kq3qdwc5wmy.4gzf3f.ng.0001.use1.cache.amazonaws.com';
      Cachette.connect();

      const cacheInstance = Cachette.getCacheInstance();
      expect(cacheInstance instanceof LocalCache).to.be.true;

      process.env.REDIS_URL = undefined;

    });

  });

  describe('decorator cached()', () => {
    interface Response {
      variant: string;
      value: number;
    }

    class MyClass {
      numCalled: number = 0;

      @Cachette.cached('myType')
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

