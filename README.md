# cachette
[![Run Status](https://api.shippable.com/projects/586da353e18a291000c53bc9/badge?branch=master)](https://app.shippable.com/github/unitoio/cachette)
[![Coverage Badge](https://api.shippable.com/projects/586da353e18a291000c53bc9/coverageBadge?branch=master)](https://app.shippable.com/github/unitoio/cachette)
[![Dependency Status](https://david-dm.org/unitoio/cachette.svg)](https://david-dm.org/unitoio/cachette)
[![npm version](https://badge.fury.io/js/cachette.svg)](https://badge.fury.io/js/cachette)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Resilient cache library supporting concurrent requests through local cache or Redis.

> **This repo is a work-in-progress and is not ready for general use.**

## Installation

```
# Making sure you have the correct node version!
nvm install
npm install --save cachette
```

## Basic usage

```javascript
const { WriteThroughCache } = require('cachette');
const request = require('request-promise');

// First, initialize the redis connection.
const cache = new WriteThroughCache(process.env.REDIS_URL);

async function fetchUrl(url) {
  console.log('fetching', url);
  const response = await request.get(url);
  console.log('fetched', url);
}

async function fetchUrlCached(url) {
  const fetchFunction = fetchUrl.bind(undefined, url);
  return cache.getOrFetchValue(url, 600, fetchFunction);
}

fetchUrlCached('https://unito.io').then(() => console.log('first call returned'));
// First call fetches the resource, the other calls use the cached value.
fetchUrlCached('https://unito.io').then(() => console.log('second call returned'));
fetchUrlCached('https://unito.io').then(() => console.log('third call returned'));
```

## License

MIT
