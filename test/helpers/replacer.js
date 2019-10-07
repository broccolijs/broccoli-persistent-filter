'use strict';

var path = require('path');
var Filter = require('../../');
var minimatch = require('minimatch');
class ReplaceFilter extends Filter{
  constructor (inputTree, _options) {
    super(inputTree, _options);
    var options = _options || {};
    this._glob = options.glob;
    this._search = options.search;
    this._replacement = options.replace;
  }
  getDestFilePath(relativePath) {
    if (this._glob === undefined) {
      return Filter.prototype.getDestFilePath.call(this, relativePath);
    }
    return minimatch(relativePath, this._glob) ? relativePath : null;
  };

  processString(contents/*, relativePath*/) {
    var result = contents.replace(this._search, this._replacement);
    return result;
  };

  baseDir() {
    return path.join(__dirname, '../../');
  };
}
module.exports = ReplaceFilter;