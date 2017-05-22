'use strict';

var Promise = require('rsvp').Promise;
var Filter = require('../../');


class Rot13Async extends Filter {
  constructor(inputTree, options) {
    super(inputTree, options);
  }

  processString(content) {
    return new Promise(function(resolve) {
      var result = content.replace(/[a-zA-Z]/g, function(c){
        return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
      });
      setTimeout(function() {
        resolve(result);
      }, 50);
    });
  }
}

module.exports = Rot13Async;
