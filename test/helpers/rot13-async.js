'use strict';

const Promise = require('rsvp').Promise;
const Filter = require('../../');


module.exports = class Rot13Async extends Filter {
  constructor(inputTree, options) {
    super(inputTree, options);
  }

  processString(content) {
    return new Promise((resolve) => {
      const result = content.replace(/[a-zA-Z]/g, (c) => {
        return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
      });
      setTimeout(() => {
        resolve(result);
      }, 50);
    });
  }
};
