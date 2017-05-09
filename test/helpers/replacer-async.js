'use strict';

var inherits = require('util').inherits;
var path = require('path');
var Promise = require('rsvp').Promise;
var Filter = require('../../');
var minimatch = require('minimatch');

module.exports = ReplaceAsyncFilter;
function ReplaceAsyncFilter(inputTree, _options) {
  var options = _options || {};

  if (!this) {
    return new ReplaceAsyncFilter(inputTree, options);
  }

  Filter.call(this, inputTree, options);

  this._glob = options.glob;
  this._search = options.search;
  this._replacement = options.replace;
}

inherits(ReplaceAsyncFilter, Filter);

ReplaceAsyncFilter.prototype.getDestFilePath = function(relativePath) {
  if (this._glob === undefined) {
    return Filter.prototype.getDestFilePath.call(this, relativePath);
  }
  return minimatch(relativePath, this._glob) ? relativePath : null;
};

ReplaceAsyncFilter.prototype.processString = function(contents/*, relativePath*/) {
  var result = contents.replace(this._search, this._replacement);
  return new Promise(function(resolve) {
    setTimeout(function() {
      resolve(result);
    }, 100);
  });
};

ReplaceAsyncFilter.prototype.baseDir = function() {
  return path.join(__dirname, '../../');
};
