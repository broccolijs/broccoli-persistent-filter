'use strict';

var Filter = require('../..');


class Rot13 extends Filter {
  processString (content) {
    return content.replace(/[a-zA-Z]/g, function(c){
      return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
  }
}
module.exports = Rot13;
