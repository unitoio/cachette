import { expect } from 'chai';

import { RedisCache } from '../src/lib/RedisCache';


describe('RedisCache', () => {

  describe('constructor', () => {
    it('will not crash the application given an invalid Redis URL', async () => {
      const cache = new RedisCache('redis://localhost:9999');
      await cache.getValue('test');
      await cache.setValue('test', 'value');
    });

    it('will raise an error if given an Redis URL without protocol', async () => {
      expect(
        () => new RedisCache('rer17kq3qdwc5wmy.4gzf3f.ng.0001.use1.cache.amazonaws.com'),
      ).to.throw();
    });
  });

  describe('value serialization', () => {

    it('can serialize the null value', () => {
      let value = RedisCache.serializeValue(null);
      expect(value).to.equal(RedisCache.NULL_VALUE);
      value = RedisCache.deserializeValue(value);
      expect(value).to.equal(null);
    });

    it('can serialize the true value', () => {
      let value = RedisCache.serializeValue(true);
      expect(value).to.equal(RedisCache.TRUE_VALUE);
      value = RedisCache.deserializeValue(value);
      expect(value).to.equal(true);
    });

    it('can serialize an object', () => {
      const obj = {
        level1: {
          level2: {
            level3: true,
          },
        },
      };
      let value = RedisCache.serializeValue(obj);
      expect(value.startsWith(RedisCache.JSON_PREFIX)).to.be.true;
      value = RedisCache.deserializeValue(value);
      expect(value).to.deep.equal(obj);
    });

    it('can serialize the false value', () => {
      let value = RedisCache.serializeValue(false);
      expect(value).to.equal(RedisCache.FALSE_VALUE);
      value = RedisCache.deserializeValue(value);
      expect(value).to.equal(false);
    });

    it('will leave a string untouched', () => {
      let value = RedisCache.serializeValue('string');
      expect(value).to.equal('string');
      value = RedisCache.deserializeValue('string');
      expect(value).to.equal('string');
    });

    it('will convert null to undefined when deserializing', () => {
      const value = RedisCache.deserializeValue(null);
      expect(value).to.equal(undefined);
    });

  });

  describe('setValue', async () => {
    it('can set values', async function (): Promise<void> {
      if (!process.env.TEST_REDIS_URL) {
        this.skip();
      }

      const cache = new RedisCache(process.env.TEST_REDIS_URL as string);
      await cache.isReady();

      // Just to be sure that the cache is really empty...
      await cache.clear();

      const wasSet = await cache.setValue('key', 'value');
      expect(wasSet).to.be.true;
      expect(await cache.itemCount()).to.equal(1);
      const value = await cache.getValue('key');
      expect(value).to.equal('value');
      expect(await cache.itemCount()).to.equal(1);
    });

    it('can set values with a TTL', async function (): Promise<void> {
      if (!process.env.TEST_REDIS_URL) {
        this.skip();
      }

      const cache = new RedisCache(process.env.TEST_REDIS_URL as string);
      await cache.isReady();

      // Just to be sure that the cache is really empty...
      await cache.clear();

      const wasSet = await cache.setValue('key', 'value', 30000);
      expect(wasSet).to.be.true;

      const value = await cache.getValue('key');
      expect(value).to.equal('value');

      expect(await cache.itemCount()).to.equal(1);

      const ttl = await cache.getTtl('key');
      expect(ttl).to.exist;
      expect(ttl).to.be.above(0);
      expect(ttl).to.not.be.above(30000000);
    });

  });

  describe('itemCount', async () => {

    it('can count the items in the redis cache.', async function (): Promise<void> {
      if (!process.env.TEST_REDIS_URL) {
        this.skip();
      }

      const cache = new RedisCache(process.env.TEST_REDIS_URL as string);
      await cache.isReady();

      // Just to be sure that the cache is really empty...
      await cache.clear();

      await cache.setValue('test1', 'value1');
      await cache.setValue('test2', 'value2');
      await cache.setValue('test3', 'value3');
      expect(await cache.itemCount()).to.equal(3);
      await cache.clear();
      expect(await cache.itemCount()).to.equal(0);
    });
  });

});
