'use strict';

const path = require('path');
const Promise = require('rsvp').Promise;
const Filter = require('../../');
const minimatch = require('minimatch');

module.exports = class ReplaceAsyncFilter extends Filter {
  constructor(inputTree, _options) {
    let options = _options || {};

    super(inputTree, options);

    this._glob = options.glob;
    this._search = options.search;
    this._replacement = options.replace;
  }

  getDestFilePath(entry) {
    let relativePath = entry.relativePath;
  
    if (this._glob === undefined) {
      return Filter.prototype.getDestFilePath.call(this, entry);
    }
    return minimatch(relativePath, this._glob) ? relativePath : null;
  }

  processString(contents/*, relativePath*/) {
    const result = contents.replace(this._search, this._replacement);
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(result);
      }, 50);
    });
  }

  baseDir() {
    return path.join(__dirname, '../../');
  }
};
