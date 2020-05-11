import * as path from 'path';
import Filter = require('broccoli-persistent-filter');
import { ProcessStringResult } from '../lib/strategies/strategy';

class PathAnnotator extends Filter {
  processString(contents: string, relativePath: string) {
    return `/* ${relativePath} */\n${contents}`;
  }
  canProcessFile(relativePath: string): boolean {
    const ext = path.extname(relativePath);
    return ext === '.css' || ext === '.js';
  }
}

// Using the async/promise API

class LazyPathAnnotator extends Filter {
  canProcessFile(relativePath: string): boolean {
    const ext = path.extname(relativePath);
    return ext === '.css' || ext === '.js';
  }
  processString(contents: string, relativePath: string) {
    return new Promise((resolve) => {
      setTimeout(resolve, 10);
    }).then(() => {
      return `/* ${relativePath} */\n${contents}`;
    })
  }
  postProcess(results: ProcessStringResult, relativePath: string) {
    return Promise.resolve(results);
  }
}

// Using a filter with custom data:

interface MyCustomProcessingData {
  byteCount: number;
}

class MyPostProcessingFilter extends Filter {
  processString(contents: string, relativePath: string): ProcessStringResult & MyCustomProcessingData {
    return {
      output: contents,
      byteCount: contents.length,
    };
  }
  postProcess(results: ProcessStringResult & MyCustomProcessingData, relativePath: string) {
    // It should be legal to set the output.
    results.output = 'Updated output';
    const numBytes = results.byteCount; // $ExpectType number
    if (numBytes > 1024) {
      // it should be valid to only return the output (without custom data)
      return {
        output: results.output.substring(0, 1024),
      }
    } else {
      // it should also be able to return the output with the custom data.
      // even though that data won't be used by anything else now.
      return results;
    }
  }
}
