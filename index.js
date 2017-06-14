'use strict';

var path = require('path');
var Promise = require('rsvp').Promise;
var Plugin = require('broccoli-plugin');
var mapSeries = require('promise-map-series');
var debugGenerator = require('heimdalljs-logger');
var md5Hex = require('md5-hex');
var Processor = require('./lib/processor');
var defaultProccessor = require('./lib/strategies/default');
var hashForDep = require('hash-for-dep');
var BlankObject = require('blank-object');
var FSTree = require('fs-tree-diff');
var heimdall = require('heimdalljs');


function ApplyPatchesSchema() {
  this.mkdir = 0;
  this.rmdir = 0;
  this.unlink = 0;
  this.change = 0;
  this.create = 0;
  this.other = 0;
  this.processed = 0;
  this.linked = 0;

  this.processString = 0;
  this.processStringTime = 0;
  this.persistentCacheHit = 0;
  this.persistentCachePrime = 0;
}

function DerivePatchesSchema() {
  this.patches = 0;
  this.entries = 0;
}

module.exports = Filter;

Filter.prototype = Object.create(Plugin.prototype);
Filter.prototype.constructor = Filter;

function Filter(inputTree, options) {
  if (!this || !(this instanceof Filter) ||
      Object.getPrototypeOf(this) === Filter.prototype) {
    throw new TypeError('Filter is an abstract class and must be sub-classed');
  }

  var loggerName = 'broccoli-persistent-filter:' + (this.constructor.name);
  var annotation = (options && options.annotation) || this.annotation || this.description;

  if (annotation) {
    loggerName += ' > [' + annotation + ']';
  }

  this._logger = debugGenerator(loggerName);

  Plugin.call(this, [inputTree], {
    name: (options && options.name) || this.name || loggerName,
    annotation: (options && options.annotation) || this.annotation || annotation,
    fsFacade: true,
    persistentOutput: true
  });

  this.processor = new Processor(options);
  this.processor.setStrategy(defaultProccessor);
  this.currentTree = new FSTree();
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

function nanosecondsSince(time) {
  var delta = process.hrtime(time);
  return delta[0] * 1e9 + delta[1];
}

function chompPathSep(path) {
  // strip trailing path.sep (but both seps on posix and win32);
  return path.replace(/(\/|\\)$/, '');
}


function timeSince(time) {
  var deltaNS = nanosecondsSince(time);
  return (deltaNS / 1e6).toFixed(2) +' ms';
}

Filter.prototype.build = function() {
  var srcDir = this.inputPaths[0];
  var destDir = this.outputPath;
  var instrumentation = heimdall.start('derivePatches - persistent filter', DerivePatchesSchema);
  const patches = this.in[0].changes();

  console.log(`----------------patches from ${this._name + (this._annotation != null ? ' (' + this._annotation + ')' : '')}`);
  patches.forEach(patch => {
    console.log(patch[0] + ' ' + chompPathSep(patch[1]));
  });

  instrumentation.stats.patchesLength = patches.length;
  instrumentation.stop();

  return heimdall.node('applyPatches - persistent filter', ApplyPatchesSchema, function(instrumentation) {
    var prevTime = process.hrtime();

    var result = mapSeries(patches, function(patch) {
      var operation = patch[0];
      var relativePath = patch[1];
      var entry = patch[2];
      var destPath = this.getDestFilePath(relativePath) || relativePath;

      this._logger.debug('[operation:%s] %s', operation, relativePath);
      switch (operation) {
        case 'mkdir': {
          instrumentation.mkdir++;
          return this.out.mkdirSync(relativePath);
        } case 'mkdirp'  : {
          instrumentation.mkdirp++;
          return this.out.mkdirpSync(relativePath);
        } case 'rmdir': {
          instrumentation.rmdir++;
        return this.out.rmdirSync(relativePath);
        } case 'unlink': {
          instrumentation.unlink++;
          return this.out.unlinkSync(destPath);
        } case 'change': {
          instrumentation.change++;
          return this._handleFile(relativePath, srcDir, destDir, entry,  true, instrumentation);
        } case 'create': {
          instrumentation.create++;
          return this._handleFile(relativePath, srcDir, destDir, entry,  false, instrumentation);
        } default: {
          instrumentation.other++;
        }
      }
    }, this);

    this._logger.info('applyPatches', 'duration:', timeSince(prevTime), JSON.stringify(instrumentation));
    return result;

  }, this);
};

function chompPathSep(path) {
  // strip trailing path.sep (but both seps on posix and win32);
  return path.replace(/(\/|\\)$/, '');
}


Filter.prototype._handleFile = function(relativePath, srcDir, destDir, entry, isChange, instrumentation) {

  if (this.canProcessFile(relativePath)) {
    instrumentation.processed++;

    return this.processAndCacheFile(srcDir, destDir, entry, isChange, instrumentation);
  } else {
    instrumentation.linked++;
    if (isChange) {
        this.out.unlinkSync(relativePath);
    }
    return this.out.symlinkSyncFromEntry(this.in[0], relativePath, relativePath);
  }
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

Filter.prototype.processAndCacheFile = function(srcDir, destDir, entry, isChange, instrumentation) {
  var filter = this;
  var relativePath = entry.relativePath;

  return Promise.resolve().
      then(function asyncProcessFile() {

    return filter.processFile(srcDir, destDir, relativePath, isChange, instrumentation);
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

Filter.prototype.processFile = function(srcDir, destDir, relativePath, isChange, instrumentation) {
  var filter = this;
  var inputEncoding = this.inputEncoding;
  var outputEncoding = this.outputEncoding;

  if (inputEncoding === undefined)  inputEncoding  = 'utf8';
  if (outputEncoding === undefined) outputEncoding = 'utf8';


   var contents = this.in[0].readFileSync(relativePath, {
    encoding: inputEncoding
  });

  instrumentation.processString++;

  var processStringStart = process.hrtime();
  var string = invoke(this.processor, this.processor.processString, [this, contents, relativePath, instrumentation]);

  return string.then(function asyncOutputFilteredFile(outputString) {

    instrumentation.processStringTime += nanosecondsSince(processStringStart);
    var destRelativePath = filter.getDestFilePath(relativePath);

    if (destRelativePath == null) {
      throw new Error('canProcessFile("' + relativePath +
                      '") is true, but getDestFilePath("' +
                      relativePath + '") is null');
    }

    if (isChange) {
      var isSame = this.in[0].readFileSync(relativePath, 'UTF-8') === outputString;

      if (isSame) {
        this._logger.debug('[change:%s] but was the same, skipping', relativePath, isSame);
        return;
      } else {
        this._logger.debug('[change:%s] but was NOT the same, writing new file', relativePath);
      }
    }

   try {
      this.out.writeFileSync(destRelativePath, outputString, {
        encoding: outputEncoding
      });

     } catch(e) {
      // optimistically assume the DIR was patched correctly

     this.out.mkdirpSync(path.dirname(destRelativePath));
     this.out.writeFileSync(destRelativePath, outputString, {
        encoding: outputEncoding
      });
   }
    return outputString;
  }.bind(this));
};

Filter.prototype.processString = function(/* contents, relativePath */) {
  throw new Error(
      'When subclassing broccoli-persistent-filter you must implement the ' +
      '`processString()` method.');
};

Filter.prototype.postProcess = function(result /*, relativePath */) {
  return result;
};
