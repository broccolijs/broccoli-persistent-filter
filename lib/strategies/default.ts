import { Context, ProcessStringResult, Strategy } from "./strategy";
import Dependencies = require('../dependencies');
import assertNever from '../util/assertNever';

const DefaultStrategy: Strategy = {
  init() { },
  async processString(ctx: Context, contents: string, relativePath: string): Promise<string> {
    let output = await ctx.processString(contents, relativePath)
    let normalizedValue: ProcessStringResult;

    if (typeof output === 'string') {
      normalizedValue = { output }
    } else {
      normalizedValue = output;
    }

    let result;
    if (ctx.postProcess) {
      result = await ctx.postProcess(normalizedValue, relativePath);
    } else {
      result = normalizedValue;
    }

    if (result === undefined) {
      assertNever(result, 'You must return an object from `Filter.prototype.postProcess`.');
    }

    return result.output;
  },

  /**
   * By default initial dependencies are empty.
   */
  initialDependencies(srcDir: string, options: Dependencies.Options): Dependencies {
    // Dependencies start out empty and sealed as if they came from
    // the previous build iteration.
    return (new Dependencies(srcDir, options)).seal().captureDependencyState();
  },

  /**
   * Seals the dependencies and captures the dependency state.
   * @param dependencies {Dependencies} The dependencies to seal.
   */
  sealDependencies(dependencies: Dependencies): void {
    dependencies.seal().captureDependencyState();
  }
};

export = DefaultStrategy;