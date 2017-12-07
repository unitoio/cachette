import 'mocha';
import { expect } from 'chai';
import { CacheClient } from '../src/lib/CacheClient';
import { LocalCache } from '../src/lib/LocalCache';


describe('CacheClient', () => {

  describe('decorator cached()', () => {

    interface Response {
      variant: string;
      value: number;
    }

    class MyClass extends CacheClient {
      numCalled: number = 0;

      cacheInstance = new LocalCache();

      @CacheClient.cached()
      async fetchSomething(variant: string): Promise<Response> {
        this.numCalled++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          variant: variant,
          value: 100 + parseInt(variant, 10),
        };
      }
    }

    it('protect against concurrent fetches', async () => {
      const myObj = new MyClass();
      const jobs: Promise<any>[] = [];

      for (let i = 0; i < 100; i++) {
        const variant = i % 10;
        jobs.push(myObj.fetchSomething(variant.toString()));
      }

      const results = await Promise.all(jobs);
      let numSuccess = 0;
      results.forEach(x => {
        if (x.value === 100 + parseInt(x.variant, 10)) {
          numSuccess++;
        }
      });

      // Number time fetched
      expect(myObj.numCalled).to.eql(10);
      // Number successes
      expect(numSuccess).to.eql(100);
    });

  });

});
