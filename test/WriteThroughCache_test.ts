import { expect } from 'chai';

import { WriteThroughCache, LocalCache } from '../src/';


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

      const cache = new WriteThroughCache('redis://localhost:9999');
      cache['redisCache'] = new LocalCache();

      let response = await cache.setValue('key', 'value');
      expect(response).to.be.true;

      let value = await cache.getValue('key');
      expect(value).to.equal('value');

      value = await cache['localCache'].getValue('key');
      expect(value).to.equal('value');

      value = await cache['redisCache'].getValue('key');
      expect(value).to.equal('value');

    });

  });

  describe('getValue', () => {

    it('will populate the local cache when fetching from redis', async () => {

      const cache = new WriteThroughCache('redis://localhost:9999');
      cache['redisCache'] = new LocalCache();

      await cache['redisCache'].setValue('key', 'value');

      let value = await cache.getValue('key');
      expect(value).to.equal('value');

      value = await cache['localCache'].getValue('key');
      expect(value).to.equal('value');

    });

    it('will get directly from the local cache if available', async () => {

      const cache = new WriteThroughCache('redis://localhost:9999');
      cache['redisCache'] = new LocalCache();

      await cache['localCache'].setValue('key', 'value');

      let value = await cache.getValue('key');
      expect(value).to.equal('value');

      value = await cache['redisCache'].getValue('key');
      expect(value).not.to.exist;

    });

    it('will populate the local cache for a null value', async () => {

      const cache = new WriteThroughCache('redis://localhost:9999');
      cache['redisCache'] = new LocalCache();

      await cache['redisCache'].setValue('key', null);

      let value = await cache.getValue('key');
      expect(value).to.equal(null);

      value = await cache['localCache'].getValue('key');
      expect(value).to.equal(null);

    });

    it('will populate the local cache for an empty string', async () => {

      const cache = new WriteThroughCache('redis://localhost:9999');
      cache['redisCache'] = new LocalCache();

      await cache['redisCache'].setValue('key', '');

      let value = await cache.getValue('key');
      expect(value).to.equal('');

      value = await cache['localCache'].getValue('key');
      expect(value).to.equal('');

    });

  });

  describe('delValue', () => {

    it('will delete values from both caches', async () => {

      const cache = new WriteThroughCache('redis://localhost:9999');
      cache['redisCache'] = new LocalCache();

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

});
