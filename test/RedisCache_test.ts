import { expect } from 'chai';

import { RedisCache } from '../src/lib/RedisCache';


describe('RedisCache', () => {

  describe('constructor', () => {
    it('will not crash the application given an invalid Redis URL', async () => {
      let cache = new RedisCache('redis://localhost:9999');
      await cache.getValue('test');
      await cache.setValue('test', 'value');
      cache = new RedisCache('rediss://localhost:9999');
      await cache.getValue('test');
      await cache.setValue('test', 'value');
    });

    it('will raise an error if given a Redis URL without protocol', async () => {
      expect(
        () => new RedisCache('rer17kq3qdwc5wmy.4gzf3f.ng.0001.use1.cache.amazonaws.com'),
      ).to.throw();
    });

    it('will raise an error if given a Redis URL with an invalid protocol', async () => {
      expect(
        () => new RedisCache('potato://rer17kq3qdwc5wmy.4gzf3f.ng.0001.use1.cache.amazonaws.com'),
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
  
    it('can serialize an object with a nested map', () => {
      const mapStructure: Map<string, {
        checksum: number;
        originCommentId?: string;
      }> = new Map();
      mapStructure.set('key1', { checksum: 1, originCommentId: 'c1' });
      mapStructure.set('key2', { checksum: 2, originCommentId: 'c2' });
      const obj = {
        level1: {
          level2: {
            level3: {
              l3Map: mapStructure,
              l3Bool: true,
            },
            l2Map: mapStructure,
          },
          l1Map: mapStructure,
        },
      };
      let value = RedisCache.serializeValue(obj);
      expect(value.startsWith(RedisCache.JSON_PREFIX)).to.be.true;
      value = RedisCache.deserializeValue(value);
      expect(value).to.deep.equal(obj);
    });
  
    it('can serialize an object with a nested set', () => {
      const setStructure: Set<string> = new Set();
      setStructure.add('key1');
      setStructure.add('key2');
      const obj = {
        level1: {
          level2: {
            level3: {
              l3Set: setStructure,
              l3Bool: false,
            },
            l2Set: setStructure,
          },
          l1Set: setStructure,
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

    it('can set a boolean value', async function (): Promise<void> {
      if (!process.env.TEST_REDIS_URL) {
        this.skip();
      }

      const cache = new RedisCache(process.env.TEST_REDIS_URL as string);
      await cache.isReady();

      // Just to be sure that the cache is really empty...
      await cache.clear();

      let wasSet = await cache.setValue('key', true);
      expect(wasSet).to.be.true;
      let value = await cache.getValue('key');
      expect(value).to.be.true;

      wasSet = await cache.setValue('key', false);
      expect(wasSet).to.be.true;
      value = await cache.getValue('key');
      expect(value).to.be.false;

      expect(await cache.itemCount()).to.equal(1);
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

  describe('waitForReplication', () => {
      it('wait for replication', async function (): Promise<void> {
        if (!process.env.TEST_REDIS_URL) {
          this.skip();
        }

        const cache = new RedisCache(process.env.TEST_REDIS_URL as string);
        await cache.isReady();

        await cache.clear();

        await cache.setValue('test1', 'value1');
        
        const replicationAcknowledged = await cache.waitForReplication(0, 100);

        // No replicas so we expect 0. This test basically confirms that waitForRepication doesn't crash. 🤷‍♂️
        expect(replicationAcknowledged).to.equal(0);
      })
  });
});
