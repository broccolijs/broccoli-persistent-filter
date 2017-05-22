'use strict';

var path = require('path');
var Promise = require('rsvp').Promise;
var Filter = require('../../');
var minimatch = require('minimatch');

class ReplaceAsyncFilter extends Filter {
  constructor(inputTree, _options) {
    var options = _options || {};

    super(inputTree, options);

    this._glob = options.glob;
    this._search = options.search;
    this._replacement = options.replace;
  }

  getDestFilePath(relativePath) {
    if (this._glob === undefined) {
      return Filter.prototype.getDestFilePath.call(this, relativePath);
    }
    return minimatch(relativePath, this._glob) ? relativePath : null;
  }

  processString(contents/*, relativePath*/) {
    var result = contents.replace(this._search, this._replacement);
    return new Promise(function(resolve) {
      setTimeout(function() {
        resolve(result);
      }, 50);
    });
  }

  baseDir() {
    return path.join(__dirname, '../../');
  }
}

module.exports = ReplaceAsyncFilter;
