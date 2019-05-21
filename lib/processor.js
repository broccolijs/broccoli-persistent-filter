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

  processString(ctx, contents, relativePath, instrumentation) {
    // @ts-ignore
    return this.processor.processString(ctx, contents, relativePath, instrumentation);
  }
};
