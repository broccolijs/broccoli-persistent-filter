// @ts-check
'use strict';

var inherits = require('util').inherits;
var path = require('path');
var fs = require('fs');
var Filter = require('../../');
var minimatch = require('minimatch');
var resolveRelative = require('../../lib/util/resolveRelative').default;

class Inliner extends Filter {
  constructor(inputTree, _options) {
    let options = _options || {};
    options.dependencyInvalidation = true;
    super(inputTree, options);
  }
  cacheKey() {
    return "inliner";
  }

  /**
   * @param contents {string}
   * @param relativePath {string}
   * @this {Inliner}
   */
  processString(contents, relativePath) {
    /** @type {string[]} */
    let lines = contents.split("\n");
    /** @type {Array<string>} */
    let deps = [];
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let m = line.match(/\/\/\s+<<\s+(.*)\s*/);
      if (m) {
        let fileRef = m[1];
        if (path.isAbsolute(fileRef)) {
          deps.push(fileRef);
          lines[i] = fs.readFileSync(fileRef, "utf8").trim();
        } else {
          let filePath = resolveRelative(path.dirname(relativePath), fileRef);
          deps.push(filePath);
          lines[i] = this.input.readFileSync(filePath, "utf8").trim();
        }
      }
    }
    this.dependencies.setDependencies(relativePath, deps);
    return lines.join("\n");
  }
}

module.exports = Inliner;
