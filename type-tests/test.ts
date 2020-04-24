import Filter = require("broccoli-persistent-filter");

class MyFilter extends Filter {
  processString(contents: string, relativePath: string) {
    return `/* ${relativePath} */\n${contents}`;
  }
}
