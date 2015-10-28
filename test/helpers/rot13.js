'use strict';

var inherits = require('util').inherits;
var Filter = require('../../');

module.exports = Rot13;

function Rot13(inputTree, options) {
  if (!this) {
    return new Rot13(inputTree, options);
  }
  Filter.call(this, inputTree, options);
}

inherits(Rot13, Filter);

Rot13.prototype.processString = function(content) {
  return content.replace(/[a-zA-Z]/g, function(c){
    return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
  });
};
