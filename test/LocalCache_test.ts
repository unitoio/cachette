import { expect } from 'chai';
import * as Bluebird from 'bluebird';

import { LocalCache } from '../src/lib/LocalCache';


describe('LocalCache', () => {

  it('can set values', async () => {
    const cache = new LocalCache();
    const wasSet = await cache.setValue('key', 'value');
    expect(wasSet).to.be.true;
    const value = await cache.getValue('key');
    expect(value).to.equal('value');
  });

  it('will not throw if we set a value of undefined', async () => {
    const cache = new LocalCache();
    const valueWritten = await cache.setValue('key', undefined);
    expect(valueWritten).to.be.undefined;
    const value = await cache.getValue('key');
    expect(value).not.to.exist;
  });

  it('can set values with expiry', async () => {

    const cache = new LocalCache();
    await cache.setValue('key', 'value', .2);
    let value = await cache.getValue('key');
    expect(value).to.equal('value');
    await Bluebird.delay(250);
    value = await cache.getValue('key');
    expect(value).to.equal(undefined);

  });

  it('can delete a value', async () => {

    const cache = new LocalCache();
    await cache.setValue('key', 'value');

    expect(await cache.getValue('key')).to.equal('value');
    await cache.delValue('key');

    expect(await cache.getValue('key')).not.to.exist;

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
