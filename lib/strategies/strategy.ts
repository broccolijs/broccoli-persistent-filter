import Dependencies = require('../dependencies');

// TODO: ProcessStringResult and Context should be template types so that the
// consumer can strongly type their data.
export type ProcessStringResult = Record<"output", string> & Record<string, unknown>;

export interface Context {
  processString(contents: string, relativePath: string): string | ProcessStringResult | Promise<string | ProcessStringResult>;
  postProcess?(v: ProcessStringResult, relativePath: string): ProcessStringResult | Promise<ProcessStringResult>;
  cacheKey?(): string;
  cacheKeyProcessString?(contents: string, relativePath: string): string;
}

export interface InstrumentationSchema {
  persistentCacheHit: number;
  persistentCachePrime: number;
}

export interface Strategy {
  init(ctx: Context): void;
  processString(ctx: Context, contents: string, relativePath: string, forceInvalidation: boolean, instrumentation: InstrumentationSchema):  string | ProcessStringResult | Promise<string | ProcessStringResult>;
  initialDependencies(srcDir: string, options: Dependencies.Options): Dependencies;
  sealDependencies(dependencies: Dependencies): void;
}
