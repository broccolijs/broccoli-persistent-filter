'use strict';
var inherits = require('util').inherits;
var Filter = require('../../');

module.exports = IncompleteFilter;
function IncompleteFilter(inputTree, options) {
  Filter.call(this, inputTree, options);
}

inherits(IncompleteFilter, Filter);
