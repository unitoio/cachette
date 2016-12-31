
require('source-map-support').install();

import 'mocha';
import { expect } from 'chai';
import * as Bluebird from 'bluebird';

import { LocalCache } from '../lib/LocalCache';

process.env.LOG_LEVEL = 'disabled';


describe('LocalCache test case', () => {

  it('can set values', async () => {

    const cache = new LocalCache();
    cache.setValue('key', 'value');
    const value = await cache.getValue('key');
    expect(value).to.equal('value');

  });

  it('can set values with expiry', async () => {

    const cache = new LocalCache();
    await cache.setValue('key', 'value', 1);
    await Bluebird.delay(1000);
    const value = await cache.getValue('key');
    expect(value).to.equal(undefined);

  });

  it('will not grow in size past the maximum size', async () => {
    const origMax = LocalCache['MAXIMUM_CACHE_SIZE'];
    LocalCache['MAXIMUM_CACHE_SIZE'] = 5;

    const cache = new LocalCache();
    await cache.setValue('1', '1');
    await cache.setValue('2', '2');
    await cache.setValue('3', '3');
    await cache.setValue('4', '4');
    await cache.setValue('5', '5');
    await cache.setValue('6', '6');

    const cacheSize = cache['cache'].length;
    expect(cacheSize).to.equal(5);

    const oldestValue = await cache.getValue('1');
    expect(oldestValue).to.equal(undefined);

    // restore
    LocalCache['MAXIMUM_CACHE_SIZE'] = origMax;

  });

});
