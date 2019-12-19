/// @ts-check
'use strict';

const defaultProcessor = require('./strategies/default');

module.exports = class Processor {
  constructor(options) {
    options = options || {};
    this.processor = defaultProcessor;
    this.persistent = options.persist;
  }

  setStrategy(stringProcessor) {
    this.processor = stringProcessor;
  }

  init(ctx) {
    // @ts-ignore
    this.processor.init(ctx);
  }

  processString(ctx, contents, relativePath, forceInvalidation, instrumentation) {
    // @ts-ignore
    return this.processor.processString(ctx, contents, relativePath, forceInvalidation, instrumentation);
  }

  /**
   * Create the initial dependencies.
   * @param srcDir {string}
   * @param options { {[key:string]: any} } options is used to pass the custom fs opertations implementations
   * @returns {ReturnType<typeof defaultProcessor['initialDependencies']>}
   */
  initialDependencies(srcDir, options) {
    return this.processor.initialDependencies(srcDir, options);
  }

  /**
   * Seals the dependencies and captures the dependency state.
   * May cache the dependency information for the next process.
   * @param dependencies {Parameters<typeof defaultProcessor['sealDependencies']>[0]} The dependencies to seal.
   * @returns {void}
   */
  sealDependencies(dependencies) {
    this.processor.sealDependencies(dependencies);
  }
};
