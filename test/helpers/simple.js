'use strict';

var Filter = require('../../');

class MyFilter extends Filter {
  processString(string) {
    return string;
  }
}

module.exports = MyFilter;
