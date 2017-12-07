import { expect } from 'chai';

import { WriteThroughCache } from '../src/lib/WriteThroughCache';


describe('WriteThroughCache', () => {

  it('will fallback to using a local cache is no connection to redis is made', async () => {

    const cache = new WriteThroughCache('redis://localhost:9999');

    // We know the connection was not made, but we should still be able to use the local cache.
    await cache.setValue('key', 'value');
    const value = await cache.getValue('key');
    expect(value).to.equal('value');

  });

});
