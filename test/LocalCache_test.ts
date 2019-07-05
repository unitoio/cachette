import { expect } from 'chai';
import * as Bluebird from 'bluebird';

import { LocalCache } from '../src/lib/LocalCache';


describe('LocalCache', () => {

  it('can set values', async () => {
    const cache = new LocalCache();
    const wasSet = await cache.setValue('key', 'value');
    expect(wasSet).to.be.true;
    expect(await cache.itemCount()).to.equal(1);
    const value = await cache.getValue('key');
    expect(value).to.equal('value');
    expect(await cache.itemCount()).to.equal(1);
  });

  it('will not throw if we set a value of undefined', async () => {
    const cache = new LocalCache();
    expect(await cache.itemCount()).to.equal(0);
    const wasSet = await cache.setValue('key', undefined);
    expect(await cache.itemCount()).to.equal(0);
    expect(wasSet).to.be.false;
    const value = await cache.getValue('key');
    expect(await cache.itemCount()).to.equal(0);
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
    const origMax = LocalCache['DEFAULT_MAX_ITEMS'];
    LocalCache['DEFAULT_MAX_ITEMS'] = 5;

    const cache = new LocalCache();
    await cache.setValue('1', '1');
    await cache.setValue('2', '2');
    await cache.setValue('3', '3');
    await cache.setValue('4', '4');
    await cache.setValue('5', '5');
    await cache.setValue('6', '6');
    await cache.setValue('7', '7');
    await cache.setValue('8', '8');

    const cacheSize = await cache.itemCount();
    expect(cacheSize).to.equal(5);

    const oldestValue = await cache.getValue('1');
    expect(oldestValue).to.equal(undefined);

    // restore
    LocalCache['DEFAULT_MAX_ITEMS'] = origMax;

  });

});
