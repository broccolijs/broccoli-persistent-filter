'use strict';

var inherits = require('util').inherits;
var path = require('path');
var Filter = require('../../');
var minimatch = require('minimatch');
const Entry = require('fs-tree-diff/lib/entry');

module.exports = ReplaceFilter;
function ReplaceFilter(inputTree, _options) {
  var options = _options || {};

  if (!this) {
    return new ReplaceFilter(inputTree, options);
  }

  Filter.call(this, inputTree, options);

  this._glob = options.glob;
  this._search = options.search;
  this._replacement = options.replace;
}

inherits(ReplaceFilter, Filter);

ReplaceFilter.prototype.getDestFilePath = function(entry) {
  let relativePath = entry.relativePath;
  if (this._glob === undefined) {
       return Filter.prototype.getDestFilePath.call(this, entry);

  }
  return minimatch(relativePath, this._glob) ? relativePath : null;
};

ReplaceFilter.prototype.processString = function(contents/*, relativePath*/) {
  var result = contents.replace(this._search, this._replacement);
  return result;
};

ReplaceFilter.prototype.baseDir = function() {
  return path.join(__dirname, '../../');
};
