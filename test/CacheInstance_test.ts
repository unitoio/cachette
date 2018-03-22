import { expect } from 'chai';

import { LocalCache } from '../src/lib/LocalCache';
import { FetchingFunction } from '../src/lib/CacheInstance';


describe('CacheInstance', () => {

  describe('getOrFetchValue', () => {

    const localCache = new LocalCache();
    beforeEach(() => localCache.clear());

    it('does not fetch if value in cache', async () => {
      let numCalled = 0;
      const object = {
        fetch: async (v) => {
          numCalled++;
          return v;
        },
      };

      await localCache.setValue('key', 'value');
      const fetchFunction = object.fetch.bind(object, 'newvalue');
      const value = await localCache.getOrFetchValue(
        'key',
        10,
        fetchFunction,
      );
      expect(value).to.eql('value');
      expect(numCalled).to.eql(0);
    });

    it('fetches if value not in cache', async () => {
      let numCalled = 0;
      const object = {
        fetch: async (v) => {
          numCalled++;
          return v;
        },
      };

      await localCache.setValue('key2', 'value');
      const fetchFunction = object.fetch.bind(object, 'newvalue');
      const value = await localCache.getOrFetchValue(
        'key',
        10,
        fetchFunction,
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

      await localCache.setValue('key2', 'value');

      const fetchFunction = object.fetch.bind(object, 'newvalue');
      const callGetOrFetch = () => localCache.getOrFetchValue(
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
        return localCache.getOrFetchValue(
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

      const callGetOrFetch = () => localCache.getOrFetchValue(
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

  });

});
