import { expect } from 'chai';
import * as sinon from 'sinon';

import { WriteThroughCache, LocalCache } from '../src/';

function makeFakeWriteThroughCache(): WriteThroughCache {
  const cache = new WriteThroughCache('redis://localhost:9999');
  cache['redisCacheForWriting'] = new LocalCache();
  cache['redisCacheForWriting'].getTtl = async () => 1;
  cache['redisCacheForReading'] = cache['redisCacheForWriting'];
  return cache;
}


describe('WriteThroughCache', () => {

  it('will fallback to using a local cache is no connection to redis is made', async () => {

    const cache = new WriteThroughCache('redis://localhost:9999');

    // We know the connection was not made, but we should still be able to use the local cache.
    await cache.setValue('key', 'value');
    const value = await cache.getValue('key');
    expect(value).to.equal('value');

  });

  describe('setValue', () => {

    it('will write the value in both caches', async () => {

      const cache = makeFakeWriteThroughCache();

      const response = await cache.setValue('key', 'value');
      expect(response).to.be.true;

      let value = await cache.getValue('key');
      expect(value).to.equal('value');

      value = await cache['localCache'].getValue('key');
      expect(value).to.equal('value');

      value = await cache['redisCacheForReading'].getValue('key');
      expect(value).to.equal('value');

    });

  });

  describe('getValue', () => {

    it('will populate the local cache with right ttl when fetching from redis', async function (): Promise<void> {

      if (!process.env.TEST_REDIS_URL) {
        this.skip();
      }
      const cache = new WriteThroughCache(process.env.TEST_REDIS_URL as string);
      const spy = sinon.spy(cache['localCache'], 'setValue');

      // await for Redis connection to be up
      await cache.isReady();

      await cache['redisCacheForWriting'].setValue('key', 'value', 100);

      let value = await cache.getValue('key');
      expect(value).to.equal('value');
      sinon.assert.calledWith(spy, 'key', 'value', sinon.match(ttl => ttl > 99.9 && ttl <= 100));

      value = await cache['localCache'].getValue('key');
      expect(value).to.equal('value');

    });

    it('will get directly from the local cache if available', async () => {

      const cache = makeFakeWriteThroughCache();

      await cache['localCache'].setValue('key', 'value');

      let value = await cache.getValue('key');
      expect(value).to.equal('value');

      value = await cache['redisCacheForReading'].getValue('key');
      expect(value).not.to.exist;

    });

    it('will populate the local cache for a null value', async () => {

      const cache = makeFakeWriteThroughCache();

      await cache['redisCacheForWriting'].setValue('key', null);

      let value = await cache.getValue('key');
      expect(value).to.equal(null);

      value = await cache['localCache'].getValue('key');
      expect(value).to.equal(null);

    });

    it('will populate the local cache for an empty string', async () => {

      const cache = makeFakeWriteThroughCache();

      await cache['redisCacheForWriting'].setValue('key', '');

      let value = await cache.getValue('key');
      expect(value).to.equal('');

      value = await cache['localCache'].getValue('key');
      expect(value).to.equal('');

    });

    it('returns nothing if value in cache has expired', async function (): Promise<void> {
      if (!process.env.TEST_REDIS_URL) {
        this.skip();
      }
      const cache = new WriteThroughCache(process.env.TEST_REDIS_URL as string);
      await cache.setValue('fakeKey', 'fakeValue', 0.1);
      // sleep 100 ms
      await new Promise(resolve => setTimeout(resolve, 150));
      const fakeValue = await cache.getValue('fakeKey');
      expect(fakeValue).to.be.undefined;
    });

  });

  describe('delValue', () => {

    it('will delete values from both caches', async () => {

      const cache = makeFakeWriteThroughCache();

      await cache.setValue('key', 'value');

      let value = await cache.getValue('key');
      expect(value).to.equal('value');

      value = await cache['localCache'].getValue('key');
      expect(value).to.equal('value');

      await cache.delValue('key');

      value = await cache.getValue('key');
      expect(value).not.to.exist;

      value = await cache['localCache'].getValue('key');
      expect(value).not.to.exist;

    });

  });

  describe('clear', () => {

    it('clears from both caches', async () => {
      const cache = makeFakeWriteThroughCache();

      const base = [...Array(10).keys()];
      await Promise.all(base.map(i => cache.setValue(`key${i}`, i)));
      expect(await cache.itemCount()).to.equal(20);

      let values = await Promise.all(base.map(i => cache.getValue(`key${i}`)));
      expect(values.sort()).to.eql(base);

      await cache.clear();
      expect(await cache.itemCount()).to.equal(0);

      values = await Promise.all(base.map(i => cache.getValue(`key${i}`)));
      values.forEach(value => expect(value).to.be.undefined);
    });

  });

});
