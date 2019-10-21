'use strict';

var Filter = require('../../');

class IncompleteFilter extends Filter {
  constructor(inputTree, options) {
    super(inputTree, options);
  }
}

module.exports = IncompleteFilter;
