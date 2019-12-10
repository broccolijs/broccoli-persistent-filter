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
   * @param inputPaths {string[]]}
   * @returns {ReturnType<typeof defaultProcessor['initialDependencies']>}
   */
  initialDependencies(inputPaths) {
    return this.processor.initialDependencies(inputPaths);
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
