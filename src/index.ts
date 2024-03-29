import type { InputNode } from 'broccoli-node-api';
import queue = require('async-promise-queue');
import Plugin = require('broccoli-plugin');
import FSTree = require('fs-tree-diff');
import hashForDep = require('hash-for-dep');
import heimdall = require('heimdalljs');
import debugGenerator = require('heimdalljs-logger');
import * as path from 'path';
import mapSeries = require('promise-map-series');

import addPatches = require('./addPatches');
import Dependencies = require('./dependencies');
import md5Hex = require('./md5-hex');
import Processor = require('./processor');
import { ProcessStringResult as ProcessResult } from './strategies/strategy';
import Entry from 'fs-tree-diff/lib/entry';

class ApplyPatchesSchema {
  mkdir: number;
  rmdir: number;
  unlink: number;
  change: number;
  create: number;
  other: number;
  processed: number;
  linked: number;
  handleFile: number;

  processString: number;
  processStringTime: number;
  persistentCacheHit: number;
  persistentCachePrime: number;
  handleFileTime: number;

  constructor() {
    this.mkdir = 0;
    this.rmdir = 0;
    this.unlink = 0;
    this.change = 0;
    this.create = 0;
    this.other = 0;
    this.processed = 0;
    this.linked = 0;
    this.handleFile = 0;

    this.processString = 0;
    this.processStringTime = 0;
    this.persistentCacheHit = 0;
    this.persistentCachePrime = 0;
    this.handleFileTime = 0;
  }
}

class DerivePatchesSchema {
  patches: number;
  entries: number;
  walk: {
    entries: number;
    duration: string;
  };
  invalidations: {
    dependencies: number,
    count: number,
    duration: string
  };
  constructor() {
    this.patches = 0;
    this.entries = 0;
    this.walk = {
      entries: 0,
      duration: ''
    };
    this.invalidations = {
      dependencies: 0,
      count: 0,
      duration: '',
    };
  }
}

const worker = queue.async.asyncify((doWork: () => void) => doWork());

function nanosecondsSince(time: [number, number]) {
  let delta = process.hrtime(time);
  return delta[0] * 1e9 + delta[1];
}

function timeSince(time: [number, number]) {
  let deltaNS = nanosecondsSince(time);
  return (deltaNS / 1e6).toFixed(2) +' ms';
}

/**
 * @param invalidated {Array<string>} The files that have been invalidated.
 * @param currentTree {FSTree} the current tree - for entry lookup.
 * @param nextTree {FSTree} The next tree - for entry lookup.
 */
function invalidationsAsPatches(invalidated: Array<string>, currentTree: FSTree, nextTree: FSTree): FSTree.Patch {
  if (invalidated.length === 0) {
    return [];
  }
  let patches: FSTree.Patch = [];
  let currentEntries: Record<string, FSTree.Entry> = {};
  for (let entry of currentTree.entries) {
    currentEntries[entry.relativePath] = entry;
  }
  let nextEntries: Record<string, FSTree.Entry> = {};
  for (let entry of nextTree.entries) {
    nextEntries[entry.relativePath] = entry;
  }
  for (let file of invalidated) {
    if (currentEntries[file]) {
      patches.push(['change', file, currentEntries[file]]);
    } else if (nextEntries[file]) {
      patches.push(['create', file, nextEntries[file]]);
    }
  }
  return patches;
}

async function invoke<T extends object, Args extends Array<unknown>, R>(context: T, fn: (this: T, ...args: Args) => R, args: Args): Promise<R> {
  return await fn.apply(context, args);
}

interface Options {
  name?: string;
  annotation?: string;
  persist?: boolean;
  extensions?: Array<string>;
  targetExtension?: string;
  inputEncoding?: string;
  outputEncoding?: string;
  async?: boolean;
  dependencyInvalidation?: boolean;
  concurrency?: number;
}

abstract class Filter extends Plugin {
  processor: Processor;
  dependencies: Dependencies | null;
  currentTree: FSTree;
  extensions: undefined | Array<string>;
  targetExtension: string | undefined;
  inputEncoding: string | undefined;
  outputEncoding: string | undefined;
  async: boolean;
  dependencyInvalidation: boolean;
  _canProcessCache: object;
  _destFilePathCache: object;
  _needsReset: boolean;
  concurrency: number;
  _outputLinks: Record<string, boolean>;
  _logger: debugGenerator.Logger;
  _processorInitialized: boolean;

  static shouldPersist(env: typeof process.env, persist: boolean | undefined): boolean {
    let result;

    if (env.CI) {
      result = persist && env.FORCE_PERSISTENCE_IN_CI;
    } else {
      result = persist;
    }

    return !!result;
  }

  constructor(inputTree: InputNode, options: Options) {
    super([inputTree], {
      name: (options && options.name),
      annotation: (options && options.annotation),
      persistentOutput: true
    });

    if (Object.getPrototypeOf(this) === Filter.prototype) {
      throw new TypeError('[BroccoliPersistentFilter] BroccoliPersistentFilter Is an abstract class, and cannot be instantiated directly, rather is intended to be sub-classed');
    }

    let loggerName = 'broccoli-persistent-filter:' + (this.constructor.name);
    let annotation = (options && options.annotation);
    if (annotation) {
      loggerName += ' > [' + annotation + ']';
    }

    this._logger = debugGenerator(loggerName);

    this.processor = new Processor(options);
    this.dependencies = null;

    this.currentTree = new FSTree();
    this.async = false;

    /* Destructuring assignment in node 0.12.2 would be really handy for this! */
    if (options) {
      if (options.extensions != null)      this.extensions = options.extensions;
      if (options.targetExtension != null) this.targetExtension = options.targetExtension;
      if (options.inputEncoding != null)   this.inputEncoding = options.inputEncoding;
      if (options.outputEncoding != null)  this.outputEncoding = options.outputEncoding;
      if (Filter.shouldPersist(process.env, options.persist)) {
        const PersistentStrategy = require('./strategies/persistent');

        this.processor.setStrategy(new PersistentStrategy());
      }
      this.async = (options.async === true);
    }


    this._processorInitialized = false;
    this.dependencyInvalidation = options && options.dependencyInvalidation || false;
    this._canProcessCache = Object.create(null);
    this._destFilePathCache = Object.create(null);
    this._needsReset = false;

    this.concurrency = (options && options.concurrency) || Number(process.env.JOBS) || Math.max(require('os').cpus().length - 1, 1);
    this._outputLinks = Object.create(null);
  }

  async build() {
    if (!this._processorInitialized) {
      this._processorInitialized = true;
      this.processor.init(this);
    }

    let srcDir = this.inputPaths[0];
    let destDir = this.outputPath;

    if (this.dependencyInvalidation && !this.dependencies) {
      this.dependencies = this.processor.initialDependencies(this.input, this.inputEncoding || 'utf8');
    }

    if (this._needsReset) {
      this.currentTree = new FSTree();
      let instrumentation = heimdall.start('reset');
      if (this.dependencies) {
        this.dependencies = this.processor.initialDependencies(this.input, this.inputEncoding || 'utf8');
      }
      this.output.rmdirSync('./',  { recursive: true });
      this.output.mkdirSync('./', { recursive: true });
      instrumentation.stop();
    }

    let prevTime = process.hrtime();
    let instrumentation = heimdall.start('derivePatches', DerivePatchesSchema);

    let walkStart = process.hrtime();
    let entries = this.input.entries('./');
    let nextTree = FSTree.fromEntries(entries);
    let walkDuration = timeSince(walkStart);

    let invalidationsStart = process.hrtime();
    let invalidated = this.dependencies && this.dependencies.getInvalidatedFiles() || [];
    this._logger.info('found', invalidated.length, 'files invalidated due to dependency changes.');
    let invalidationPatches = invalidationsAsPatches(invalidated, this.currentTree, nextTree);
    let invalidationsDuration = timeSince(invalidationsStart);

    let patches = this.currentTree.calculatePatch(nextTree);
    patches = addPatches(invalidationPatches, patches);

    instrumentation.stats.patches = patches.length;
    instrumentation.stats.entries = entries.length;
    instrumentation.stats.invalidations = {
      dependencies: this.dependencies ? this.dependencies.countUnique() : 0,
      count: invalidationPatches.length,
      duration: invalidationsDuration
    };
    instrumentation.stats.walk = {
      entries: entries.length,
      duration: walkDuration
    };

    this.currentTree = nextTree;

    this._logger.info('derivePatches', 'duration:', timeSince(prevTime), JSON.stringify(instrumentation.stats));

    instrumentation.stop();

    if (this.dependencies && patches.length > 0) {
      let files = patches.filter(p => p[0] === 'unlink').map(p => p[1]);
      this.dependencies = this.dependencies.copyWithout(files);
    }

    if (patches.length === 0) {
      // no work, exit early
      return;
    } else {
      // do actual work, that may fail
      this._needsReset = true;
    }

    // used with options.async = true to allow 'create' and 'change' operations to complete async
    const pendingWork = new Array<() => Promise<string | ProcessResult | undefined>>();
    return heimdall.node('applyPatches', ApplyPatchesSchema, async (instrumentation) => {
      let prevTime = process.hrtime();
      await mapSeries(patches, (patch: FSTree.Operation) => {
        let operation = patch[0];
        let relativePath = patch[1];
        let entry = patch[2];
        if (!entry) {
          throw new Error('internal error');
        }
        let outputPath = this.getDestFilePath(relativePath, entry) || relativePath || './';
        let outputFilePath = outputPath;
        let forceInvalidation = invalidated.includes(relativePath);

        this._logger.debug('[operation:%s] %s', operation, relativePath);

        switch (operation) {
          case 'mkdir': {
            instrumentation.mkdir++;
            return this.output.mkdirSync(outputPath);
          } case 'rmdir': {
            instrumentation.rmdir++;
            return this.output.rmdirSync(outputPath);
          } case 'unlink': {
            instrumentation.unlink++;
            return this.output.unlinkSync(outputPath);
          } case 'change': {
            // wrap this in a function so it doesn't actually run yet, and can be throttled
            let changeOperation = () => {
              instrumentation.change++;
              return this._handleFile(relativePath, srcDir, destDir, entry!, outputFilePath, forceInvalidation, true, instrumentation);
            };
            if (this.async) {
              pendingWork.push(changeOperation);
              return;
            }
            return changeOperation();
          } case 'create': {
            // wrap this in a function so it doesn't actually run yet, and can be throttled
            let createOperation = () => {
              instrumentation.create++;
              return this._handleFile(relativePath, srcDir, destDir, entry!, outputFilePath, forceInvalidation, false, instrumentation);
            };
            if (this.async) {
              pendingWork.push(createOperation);
              return;
            }
            return createOperation();
          } default: {
            instrumentation.other++;
          }
        }
      });
      const result = await queue(worker, pendingWork, this.concurrency);
      this._logger.info('applyPatches', 'duration:', timeSince(prevTime), JSON.stringify(instrumentation));
      if (this.dependencies) {
        this.processor.sealDependencies(this.dependencies);
      }
      this._needsReset = false;
      return result;
    });
  }

  async _handleFile(relativePath: string, srcDir: string, destDir: string, entry: Entry, outputPath: string, forceInvalidation: boolean, isChange: boolean, stats: ApplyPatchesSchema) {
    stats.handleFile++;

    let handleFileStart = process.hrtime();
    try {
      let result: string | ProcessResult | undefined;
      let srcPath = srcDir + '/' + relativePath;

      if (this.canProcessFile(relativePath, entry)) {
        stats.processed++;
        if (this._outputLinks[outputPath] === true) {
          delete this._outputLinks[outputPath];
          this.output.unlinkSync(outputPath);
        }
        result = await this.processAndCacheFile(srcDir, destDir, entry, forceInvalidation, isChange, stats);
      } else {
        stats.linked++;
        if (isChange) {
          this.output.unlinkSync(outputPath);
        }
        this.output.symlinkOrCopySync(srcPath, outputPath);
        result = undefined;
        this._outputLinks[outputPath] = true;
      }
      return result;
    } finally {
      stats.handleFileTime += nanosecondsSince(handleFileStart);
    }
  }

  /*
 The cache key to be used for this plugins set of dependencies. By default
 a hash is created based on `package.json` and nested dependencies.

 Implement this to customize the cache key (for example if you need to
 account for non-NPM dependencies).

 @public
 @method cacheKey
 @returns {String}
 */
  cacheKey() {
    return hashForDep(this.baseDir());
  }

/* @public
 *
 * @method baseDir
 * @returns {String} absolute path to the root of the filter...
 */
  baseDir(): string {
    throw Error('[BroccoliPersistentFilter] Filter must implement prototype.baseDir');
  }

  /**
   * @public
   *
   * optionally override this to build a more robust cache key
   * @param  {String} string The contents of a file that is being processed
   * @return {String}        A cache key
   */
  cacheKeyProcessString(string: string, relativePath: string) {
    return md5Hex(string + 0x00 + relativePath);
  }

  canProcessFile(relativePath: string, entry: Entry) {
    return !!this.getDestFilePath(relativePath, entry);
  }

  isDirectory(relativePath: string, entry: Entry) {
    if (this.inputPaths === undefined) {
      return false;
    }

    if (entry !== undefined) {
      return entry.isDirectory();
    } else {
      try {
        // wrap this in try/catch in case `relativePath` doesn't exist
        const stat = this.input.lstatSync(relativePath);
        return stat.isDirectory();
      } catch (error) {
        // if we get any other error, we really don't know what is going on so we need to rethrow
        if (error.code === 'ENOENT') {
          return false;
        }
        throw error;
      }
    }
  }

  getDestFilePath(relativePath: string, entry: Entry) {
    // NOTE: relativePath may have been moved or unlinked
    if (this.isDirectory(relativePath, entry)) {
      return null;
    }

    if (this.extensions == null) {
      return relativePath;
    }

    for (let i = 0, ii = this.extensions.length; i < ii; ++i) {
      let ext = this.extensions[i];
      if (relativePath.slice(-ext.length - 1) === '.' + ext) {
        if (this.targetExtension != null) {
          relativePath = relativePath.slice(0, -ext.length) + this.targetExtension;
        }
        return relativePath;
      }
    }

    return null;
  }

  async processAndCacheFile(srcDir: string, destDir: string, entry: Entry, forceInvalidation: boolean, isChange: boolean, instrumentation: ApplyPatchesSchema): Promise<string | ProcessResult | undefined> {
    let filter = this;
    let relativePath = entry.relativePath;
    try {
      return await filter.processFile(srcDir, destDir, relativePath, forceInvalidation, isChange, instrumentation, entry);
    } catch (e) {
      let error = e;
      if (typeof e !== 'object') error = new Error('' + e);
      error.file = relativePath;
      error.treeDir = srcDir;
      throw error;
    }
  }

  async processFile(_srcDir: string, _destDir: string, relativePath: string, forceInvalidation: boolean, isChange: boolean, instrumentation: ApplyPatchesSchema, entry: Entry): Promise<string | ProcessResult | undefined> {
    let filter = this;
    let inputEncoding = this.inputEncoding;
    let outputEncoding = this.outputEncoding;

    if (inputEncoding === undefined)  inputEncoding  = 'utf8';
    if (outputEncoding === undefined) outputEncoding = 'utf8';

    let contents = this.input.readFileSync(relativePath, {
      encoding: inputEncoding
    });

    instrumentation.processString++;
    let processStringStart = process.hrtime();
    let output = await invoke(this.processor, this.processor.processString, [this, contents, relativePath, forceInvalidation, instrumentation]);
    instrumentation.processStringTime += nanosecondsSince(processStringStart);
    let outputString = typeof output === 'string' ? output : output.output;
    let outputPath = filter.getDestFilePath(relativePath, entry);

    if (outputPath == null) {
      throw new Error('[BroccoliPersistentFilter] canProcessFile("' + relativePath +
                      '") is true, but getDestFilePath("' +
                      relativePath + '") is null');
    }

    if (isChange) {
      let isSame = this.output.readFileSync(outputPath, 'UTF-8') === outputString;
      if (isSame) {
        this._logger.debug('[change:%s] but was the same, skipping', relativePath, isSame);
        return;
      } else {
        this._logger.debug('[change:%s] but was NOT the same, writing new file', relativePath);
      }
    }

    try {
      this.output.writeFileSync(outputPath, outputString, {
        encoding: outputEncoding
      });

    } catch (e) {
      if (e !== null && typeof e === 'object' && e.code === 'ENOENT') {
        this.output.mkdirSync(path.dirname(outputPath), { recursive: true });
        this.output.writeFileSync(outputPath, outputString, {
          encoding: outputEncoding
        });
      } else {
        // unexpected error, simply re-throw;
        throw e;
      }
    }

    return output;
  }

  /**
   * @param _contents {string}
   * @param _relativePath {string}
   * @returns {string}
   */
  processString(_contents: string, _relativePath: string): string | ProcessResult | Promise<string | ProcessResult> {
    throw new Error(
        '[BroccoliPersistentFilter] When subclassing broccoli-persistent-filter you must implement the ' +
        '`processString()` method.');
  }

  postProcess(result: ProcessResult, _relativePath: string): ProcessResult | Promise<ProcessResult> {
    return result;
  }
}

namespace Filter {
  export type ProcessStringResult<Data = {}> = ProcessResult<Data>;
}

export = Filter;
