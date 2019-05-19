/// @ts-check

const path = require("path");
const fs = require("fs");
const Entry = require("fs-tree-diff/lib/entry").default;
const FSTree = require("fs-tree-diff");
module.exports = class Dependencies {
  /**
   * Creates an instance of Dependencies.
   * @param rootDir {string} The root directory containing the files that
   *   have dependencies. Relative paths are resolved against this directory.
   */
  constructor(rootDir) {
    /**
     * Tracks whether new dependencies can be added.
     **/
    this.sealed = false;
    /**
     * The root directory containing the files that have dependencies. Relative
     * paths are resolved against this directory.
     * @type {string}
     */
    this.rootDir = rootDir;
    /**
     * Tracks dependencies on a per file basis.
     * The key is a relative path, values are absolute paths.
     * @type {Map<string, Array<string>>}
     **/
    this.dependencyMap = new Map();
    /**
     * Map of filesystem roots to unique dependencies on that filesystem. This
     * property is only populated once `seal()` is called. This allows us to
     * build an FSTree (which requires relative paths) per filesystem root.
     * @type {Map<string, Set<string>>}
     */
    this.allDependencies = new Map();
    /**
     * Map of filesystem roots to FSTrees, capturing the state of all
     * dependencies.
     * @type {Map<string, FSTree<Entry>>}
     */
    this.fsTrees = new Map();
    /**
     * Maps dependencies to the files that depend on them.
     * Keys are absolute paths, values are paths relative to the `rootDir`.
     * @type Map<string, Array<string>>;
     */
    this.dependentsMap = new Map();
  }

  /**
   * Seals the dependencies. No more dependencies can be added once this is
   * called.
   */
  seal() {
    this.sealed = true;
    this.dependencyMap.forEach((deps, referer) => {
      for (let i = 0; i < deps.length; i++) {
        // Build a unified set of dependencies for the entire tree
        let root = path.parse(deps[i]).root;
        let depsForRoot = this.allDependencies.get(root);
        if (!depsForRoot) {
          depsForRoot = new Set();
          this.allDependencies.set(root, depsForRoot);
        }
        depsForRoot.add(path.relative(root, deps[i]));

        // Create an inverse map so that when a dependency is invalidated
        // we can track it back to the file that should be processed again.
        let dependents = this.dependentsMap.get(deps[i]);
        if (!dependents) {
          dependents = [];
          this.dependentsMap.set(deps[i], dependents);
        }
        dependents.push(referer);
      }
    });
  }

  unseal() {
    this.sealed = false;
    this.allDependencies.clear();
    this.fsTrees.clear();
  }

  /**
   * Set the dependencies for the file specified by `filePath`.
   *
   * @param filePath {string} relative path of the file that has dependencies.
   * @param dependencies {Array<string>} absolute or relative paths the file
   *   depends on. Relative paths are resolved relative to the directory
   *   containing the file that depends on them.
   */
  setDependencies(filePath, dependencies) {
    if (this.sealed) {
      throw new Error("Cannot set dependencies when sealed");
    }
    /** @type {Array<string>} */
    let absoluteDeps = [];
    let fileDir = path.dirname(filePath);
    for (let i = 0; i < dependencies.length; i++) {
      let depPath = dependencies[i];
      if (!path.isAbsolute(depPath)) {
        depPath = path.normalize(path.resolve(this.rootDir, fileDir, depPath));
      }
      absoluteDeps.push(depPath);
    }
    this.dependencyMap.set(filePath, absoluteDeps);
  }

  captureDependencyState() {
    this.fsTrees = this.getDependencyState();
  }

  /**
   * Compute dependencies state as fsTrees.
   * @returns {Map<string, FSTree<Entry>>} an fs tree per filesystem root.
   */
  getDependencyState() {
    /** @type {Map<string, FSTree<Entry>>} */
    let fsTrees = new Map();
    if (!this.sealed) {
      throw new Error("Cannot compute dependency state with unsealed dependencies.");
    }
    for (let fsRoot of this.allDependencies.keys()) {
      let dependencies = this.allDependencies.get(fsRoot);
      /** @type {Array<Entry>} */
      let entries = [];
      for (let dependency of dependencies) {
        let fullPath = path.join(fsRoot, dependency);
        try {
          // TODO: Share a cache of stat results across all persistent filters.
          let stats = fs.statSync(fullPath);
          let entry = Entry.fromStat(dependency, stats);
          entries.push(entry);
        } catch (e) {
          entries.push(new Entry(dependency, 0, 0));
        }
      }
      fsTrees.set(fsRoot, FSTree.fromEntries(entries, {sortAndExpand: true}));
    }
    return fsTrees;
  }

  /**
   * Returns the dependent files which have had a dependency change
   * since the last call to this method.
   * @returns {Array<string>} relative paths to the files that had a dependency change.
   */
  getInvalidatedFiles() {
    /** @type {Set<string>} */
    let invalidated = new Set();
    let currentState = this.getDependencyState();
    for (let fsRoot of this.allDependencies.keys()) {
      let oldTree = this.fsTrees.get(fsRoot);
      let currentTree = currentState.get(fsRoot);
      let patch = oldTree.calculatePatch(currentTree);
      for (let operation of patch) {
        let depPath = path.join(fsRoot, operation[1]);
        let dependents = this.dependentsMap.get(depPath);
        for (let dep of dependents) {
          invalidated.add(dep);
        }
      }
    }
    this.fsTrees = currentState;
    return new Array(...invalidated);
  }

  /**
   * Serialize to a simple, JSON-friendly object containing only the necessary data.
   * @return {{rootDir: string, dependencies: {[k: string]: string[]}, fsTrees: Array<{fsRoot: string, entries: Array<{relativePath: string, size: number, mtime: number, mode: number}>}>}}
   */
  serialize() {
    /** @type {{[k: string]: string[]}} */
    let dependencies = {};
    this.dependencyMap.forEach((deps, filePath) => {
      dependencies[filePath] = deps;
    });
    /** @type {Array<{fsRoot: string, entries: Array<{relativePath: string, size: number, mtime: number, mode: number}>}>} */
    let fsTrees = [];
    for (let fsRoot of this.fsTrees.keys()) {
      let fsTree = this.fsTrees.get(fsRoot);
      /** @type {Array<{relativePath: string, size: number, mtime: number, mode: number}>} */
      let entries = [];
      for (let entry of fsTree.entries) {
        entries.push({
          relativePath: entry.relativePath,
          size: entry.size,
          mtime: +entry.mtime,
          mode: entry.mode
        });
      }
      fsTrees.push({
        fsRoot,
        entries
      });
    }
    let serialized = {
      rootDir: this.rootDir,
      dependencies,
      fsTrees
    };
    return serialized;
  }

  /**
   * Deserialize from JSON data returned from the `serialize` method.
   *
   * @param dependencyData {ReturnType<Dependencies['serialize']>}
   * @return {Dependencies};
   */
  static deserialize(dependencyData) {
    let dependencies = new Dependencies(dependencyData.rootDir);
    let files = Object.keys(dependencyData.dependencies);
    for (let file of files) {
      dependencies.setDependencies(file, dependencyData.dependencies[file]);
    }
    /** @type {Map<string, FSTree>} */
    let fsTrees = new Map();
    for (let fsTreeData of dependencyData.fsTrees) {
      /** @type {Array<Entry>} */
      let entries = [];
      for (let entry of fsTreeData.entries) {
        entries.push(new Entry(entry.relativePath, entry.size, entry.mtime, entry.mode));
      }
      let fsTree = FSTree.fromEntries(entries);
      fsTrees.set(fsTreeData.fsRoot, fsTree);
    }
    dependencies.seal();
    dependencies.fsTrees = fsTrees;
    return dependencies;
  }

};
