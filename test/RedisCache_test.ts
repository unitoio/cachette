import 'mocha';
import { expect } from 'chai';

import { Cachette } from '../src/lib/Cachette';
import { RedisCache } from '../src/lib/RedisCache';


describe('RedisCache', () => {

  describe('buildSetArguments', () => {

    it('can return only the key and the value', () => {

      const setArguments = RedisCache.buildSetArguments('key', 'value');
      expect(setArguments).to.eql(['key', 'value']);

    });

    it('will overwrite only when passing false', () => {

      let setArguments = RedisCache.buildSetArguments('key', 'value', undefined, false);
      expect(setArguments).to.eql(['key', 'value', 'NX']);

      setArguments = RedisCache.buildSetArguments('key', 'value', undefined, true);
      expect(setArguments).to.eql(['key', 'value']);

    });

    it('will set the arguments when using time to live', () => {

      const setArguments = RedisCache.buildSetArguments('key', 'value', 20, undefined);
      expect(setArguments).to.eql(['key', 'value', 'EX', '20']);

    });

    it('supports setting the time to live to 0', () => {

      const setArguments = RedisCache.buildSetArguments('key', 'value', 0, undefined);
      expect(setArguments).to.eql(['key', 'value']);

    });

    it('supports setting all the arguments at the same time', () => {

      const setArguments = RedisCache.buildSetArguments('key', 'value', 14, false);
      expect(setArguments).to.eql(['key', 'value', 'EX', '14', 'NX']);

    });

  });

  describe('retryStrategy', () => {

    it('will not try to reconnect when it was never able to connect', () => {
      const options = { times_connected: 0 };
      const retryDirective = RedisCache.retryStrategy(options);
      expect(typeof retryDirective).not.to.equal('number');
      expect(retryDirective instanceof Error).to.be.true;
      expect((<Error> retryDirective).message).to.include('Unable to connect');
    });

    it('Will not try to reconnect when the maximum retry count has been reached', () => {
      const options = { times_connected: 1, attempt: RedisCache.MAX_RETRY_COUNT + 1 };
      const retryDirective = RedisCache.retryStrategy(options);
      expect(typeof retryDirective).not.to.equal('number');
      expect(retryDirective instanceof Error).to.be.true;
      expect((<Error> retryDirective).message).to.include('connection attempts reached');
    });

    it('Will try to reconnect when the maximum retry count has not been reached', () => {

      const options = { times_connected: 1, attempt: 1 };
      let retryDirective = RedisCache.retryStrategy(options);
      expect(typeof retryDirective).to.equal('number');
      expect(retryDirective).to.equal(RedisCache.RETRY_DELAY);

      options.attempt = RedisCache.MAX_RETRY_COUNT;
      retryDirective = RedisCache.retryStrategy(options);
      expect(typeof retryDirective).to.equal('number');
      expect(retryDirective).to.equal(RedisCache.RETRY_DELAY);

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

  it('will not crash the application given an invalid Redis URL', async () => {

    await Cachette.connect();
    const cache = new RedisCache('redis://localhost:9999');
    await cache.getValue('test');
    await cache.setValue('test', 'value');
    expect('still alive???').to.exist;

  });

});
