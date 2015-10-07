'use strict';

var inherits = require('util').inherits;
var Filter = require('../../');

module.exports = MyFilter;

function MyFilter(inputTree, options) {
  if (!this) {
    return new MyFilter(inputTree, options);
  }
  Filter.call(this, inputTree, options);
}

inherits(MyFilter, Filter);

