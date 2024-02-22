import { expect } from 'chai';

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

  it('can set/get numbers', async function (): Promise<void> {
    const cache = new LocalCache();

    await cache.setValue('numZero', 0);
    expect(await cache.getValue('numZero')).to.equal(0);

    await cache.setValue('numFloat', 123.456);
    expect(await cache.getValue('numFloat')).to.equal(123.456);

    await cache.setValue('numNegative', -99);
    expect(await cache.getValue('numNegative')).to.equal(-99);

    await cache.setValue('numMax', Number.MAX_SAFE_INTEGER);
    expect(await cache.getValue('numMax')).to.equal(Number.MAX_SAFE_INTEGER);

    await cache.setValue('numBarf', 0.1 + 0.2); // 0.30000000000000004, IEEE754
    expect(await cache.getValue('numBarf')).to.equal(0.1 + 0.2);
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
    await sleep(250);
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

  })

  it('can get the remaining TTL of an item', async () => {
    const cache = new LocalCache();
    const wasSet = await cache.setValue('key', 'value', 10 * 60);
    const cacheTtl = await cache.getTtl('key'); // returns ttl in ms

    expect(wasSet).to.be.true;
    expect(cacheTtl).to.exist;
    expect(cacheTtl).to.be.within(9 * 60 * 1000, 10 * 60 * 1000);
  });

  it('returns undefined when we call getTtl if the item does not exist in the cache', async () => {
    const cache = new LocalCache();
    const cacheTtl = await cache.getTtl('key');

    expect(cacheTtl).to.be.undefined;
  });

  it('returns 0 when we call getTtl if the item does not expire', async () => {
    const cache = new LocalCache();
    const wasSet = await cache.setValue('key', 'value');
    const cacheTtl = await cache.getTtl('key');

    expect(wasSet).to.be.true;
    expect(cacheTtl).to.equal(0);
  });

});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
