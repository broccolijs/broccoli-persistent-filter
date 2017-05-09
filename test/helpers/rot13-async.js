'use strict';

var inherits = require('util').inherits;
var Promise = require('rsvp').Promise;
var Filter = require('../../');

module.exports = Rot13Async;

function Rot13Async(inputTree, options) {
  if (!this) {
    return new Rot13Async(inputTree, options);
  }
  Filter.call(this, inputTree, options);
}

inherits(Rot13Async, Filter);

Rot13Async.prototype.processString = function(content) {
  return new Promise(function(resolve) {
    var result = content.replace(/[a-zA-Z]/g, function(c){
      return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
    setTimeout(function() {
      resolve(result);
    }, 100);
  });
};
