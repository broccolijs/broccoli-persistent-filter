'use strict';

var fs = require('fs');
var path = require('path');
var mkdirp = require('mkdirp');
var Promise = require('rsvp').Promise;
var Plugin = require('broccoli-plugin');
var walkSync = require('walk-sync');
var mapSeries = require('promise-map-series');
var symlinkOrCopySync = require('symlink-or-copy').sync;
var debugGenerator = require('debug');
var md5Hex = require('md5-hex');
var Processor = require('./lib/processor');
var defaultProccessor = require('./lib/strategies/default');
var hashForDep = require('hash-for-dep');
var BlankObject = require('blank-object');
var FSTree = require('fs-tree-diff');

module.exports = Filter;

Filter.prototype = Object.create(Plugin.prototype);
Filter.prototype.constructor = Filter;

function Filter(inputTree, options) {
  if (!this || !(this instanceof Filter) ||
      Object.getPrototypeOf(this) === Filter.prototype) {
    throw new TypeError('Filter is an abstract class and must be sub-classed');
  }

  var name = 'broccoli-persistent-filter:' + (this.constructor.name);

  if (this.description) {
    name += ' > [' + this.description + ']';
  }

  this._debug = debugGenerator(name);

  Plugin.call(this, [inputTree]);

  this.processor = new Processor(options);
  this.processor.setStrategy(defaultProccessor);
  this.currentTree = new FSTree();
  this._persistentOutput = true;

  /* Destructuring assignment in node 0.12.2 would be really handy for this! */
  if (options) {
    if (options.extensions != null)      this.extensions = options.extensions;
    if (options.targetExtension != null) this.targetExtension = options.targetExtension;
    if (options.inputEncoding != null)   this.inputEncoding = options.inputEncoding;
    if (options.outputEncoding != null)  this.outputEncoding = options.outputEncoding;
    if (options.persist) {
      this.processor.setStrategy(require('./lib/strategies/persistent'));
    }
  }

  this.processor.init(this);

  this._canProcessCache = new BlankObject();
  this._destFilePathCache = new BlankObject();
}

Filter.prototype.build = function() {
  var srcDir = this.inputPaths[0];
  var destDir = this.outputPath;
  var entries = walkSync.entries(srcDir);
  var nextTree = new FSTree.fromEntries(entries);
  var currentTree = this.currentTree;

  this.currentTree = nextTree;
  var patches = currentTree.calculatePatch(nextTree);

  return mapSeries(patches, function(patch) {
    var operation = patch[0];
    var relativePath = patch[1];
    var entry = patch[2];
    var outputPath = destDir + '/' + relativePath;

    this._debug('[operation:%s] %s', operation, relativePath);
    if (operation === 'change') {
      operation = 'create';
    }

    switch (operation) {
      case 'mkdir':  return fs.mkdirSync(outputPath);
      case 'rmdir':  return fs.rmdirSync(outputPath);
      case 'unlink': return fs.unlinkSync(outputPath);
      case 'create':
      if (this.canProcessFile(relativePath)) {
        return this.processAndCacheFile(srcDir, destDir, entry);
      } else {
        var srcPath = srcDir + '/' + relativePath;
        return symlinkOrCopySync(srcPath, outputPath);
      }
    }
  }, this);
};

/*
 The cache key to be used for this plugins set of dependencies. By default
 a hash is created based on `package.json` and nested dependencies.

 Implement this to customize the cache key (for example if you need to
 account for non-NPM dependencies).

 @public
 @method cacheKey
 @returns {String}
 */
Filter.prototype.cacheKey = function() {
  return hashForDep(this.baseDir());
};

/* @public
 *
 * @method baseDir
 * @returns {String} absolute path to the root of the filter...
 */
Filter.prototype.baseDir = function() {
  throw Error('Filter must implement prototype.baseDir');
};

/**
 * @public
 *
 * optionally override this to build a more rhobust cache key
 * @param  {String} string The contents of a file that is being processed
 * @return {String}        A cache key
 */
Filter.prototype.cacheKeyProcessString = function(string, relativePath) {
  return md5Hex(string + 0x00 + relativePath);
};

Filter.prototype.canProcessFile =
    function canProcessFile(relativePath) {
  return !!this.getDestFilePath(relativePath);
};

Filter.prototype.getDestFilePath = function(relativePath) {
  if (this.extensions == null) {
    return relativePath;
  }

  for (var i = 0, ii = this.extensions.length; i < ii; ++i) {
    var ext = this.extensions[i];
    if (relativePath.slice(-ext.length - 1) === '.' + ext) {
      if (this.targetExtension != null) {
        relativePath = relativePath.slice(0, -ext.length) + this.targetExtension;
      }
      return relativePath;
    }
  }

  return null;
};

Filter.prototype.processAndCacheFile = function(srcDir, destDir, entry) {
  var filter = this;
  var relativePath = entry.relativePath;
  var outputRelativeFile = filter.getDestFilePath(relativePath);

  return Promise.resolve().
      then(function asyncProcessFile() {
        return filter.processFile(srcDir, destDir, relativePath);
      }).
      then(undefined,
      // TODO(@caitp): error wrapper is for API compat, but is not particularly
      // useful.
      // istanbul ignore next
      function asyncProcessFileErrorWrapper(e) {
        if (typeof e !== 'object') e = new Error('' + e);
        e.file = relativePath;
        e.treeDir = srcDir;
        throw e;
      });
};

function invoke(context, fn, args) {
  return new Promise(function(resolve) {
    resolve(fn.apply(context, args));
  });
}

Filter.prototype.processFile = function(srcDir, destDir, relativePath) {
  var filter = this;
  var inputEncoding = this.inputEncoding;
  var outputEncoding = this.outputEncoding;

  if (inputEncoding === undefined)  inputEncoding  = 'utf8';
  if (outputEncoding === undefined) outputEncoding = 'utf8';

  var contents = fs.readFileSync(srcDir + '/' + relativePath, {
    encoding: inputEncoding
  });

  var string = invoke(this.processor, this.processor.processString, [this, contents, relativePath]);

  return string.then(function asyncOutputFilteredFile(outputString) {

    var outputPath = filter.getDestFilePath(relativePath);

    if (outputPath == null) {
      throw new Error('canProcessFile("' + relativePath +
                      '") is true, but getDestFilePath("' +
                      relativePath + '") is null');
    }

    outputPath = destDir + '/' + outputPath;

    try {
      fs.writeFileSync(outputPath, outputString, {
        encoding: outputEncoding
      });

    } catch(e) {
      // optimistically assume the DIR was patched correctly
      mkdirp.sync(path.dirname(outputPath));
      fs.writeFileSync(outputPath, outputString, {
        encoding: outputEncoding
      });
    }

    return outputString;
  });
};

Filter.prototype.processString = function(/* contents, relativePath */) {
  throw new Error(
      'When subclassing cauliflower-filter you must implement the ' +
      '`processString()` method.');
};
