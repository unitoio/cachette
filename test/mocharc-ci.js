'use strict';

// https://mochajs.org/#configuring-mocha-nodejs
// https://mochajs.org/#configuration-format
module.exports = {
  require: ['source-map-support/register'],
  recursive: true,
  exit: true,
  timeout: 60000,
  'no-colors': true,
};
