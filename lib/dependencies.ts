/// @ts-check
"use strict";

import * as path from "path";
import * as fs from "fs";
import FSTree = require("fs-tree-diff");
import Entry from "fs-tree-diff/lib/entry";
import { HashEntry, FSHashTree } from "./fs-hash-diff";
import md5sum = require("./md5-hex");

namespace Dependencies {
  export type FSFacade = Pick<typeof fs, "readFileSync" | "statSync">;
  export interface Options {
    fs: FSFacade;
  }
}

interface SerializedTreeEntry {
  relativePath: string;
}

interface SerializedStatEntry {
  type: 'stat';
  size: number;
  mtime: number;
  mode: number;
}

interface SerializedHashEntry {
  type: 'hash';
  hash: string;
}

type SerializedEntry = SerializedTreeEntry
                     & ( SerializedStatEntry | SerializedHashEntry);

type SerializedTree = {
  fsRoot: string,
  entries: Array<SerializedEntry>
}

interface SerializedDependencies {
  rootDir: string;
  fsTrees: Array<SerializedTree>;
  dependencies: Record<string, Array<string>>;
}

class Dependencies {
  /**
   * Tracks whether new dependencies can be added.
   **/
  private sealed: boolean;
  /**
   * The root directory containing the files that have dependencies. Relative
   * paths are resolved against this directory.
   */
  private rootDir: string;
  /**
   * Tracks dependencies on a per file basis.
   * The key is a relative path, values are absolute paths.
   **/
  private dependencyMap: Map<string, Array<string>>;
  /**
   * Map of filesystem roots to unique dependencies on that filesystem. This
   * property is only populated once `seal()` is called. This allows us to
   * build an FSTree (which requires relative paths) per filesystem root.
   */
  private allDependencies: Map<string, Set<string>>;
  /**
   * Map of filesystem roots to FSTrees, capturing the state of all
   * dependencies.
   */
  private fsTrees: Map<string, FSTree<Entry>|FSHashTree>;
  /**
   * Maps dependencies to the files that depend on them.
   * Keys are absolute paths, values are paths relative to the `rootDir`.
   */
  dependentsMap: Map<string, string[]>;
  fs: Dependencies.FSFacade;

  /**
   * Creates an instance of Dependencies.
   * @param rootDir The root directory containing the files that
   *   have dependencies. Relative paths are resolved against this directory.
   * @param options options is used to pass the custom fs opertations implementations
   */
  constructor(rootDir: string, options: Partial<Dependencies.Options> = {}) {
    this.sealed = false;
    this.rootDir = path.normalize(rootDir);
    this.dependencyMap = new Map<string, Array<string>>();
    this.allDependencies = new Map<string, Set<string>>();
    this.fsTrees = new Map<string, FSTree<Entry>|FSHashTree>();
    this.dependentsMap = new Map<string, Array<string>>();
    /**
     * Custom fs object can be passed to the custructor.
     * This helps us to pass the this.input of the broccoli-plugin
     * to keep the encapsulations.
     * @type {typeof fs}
     */
    this.fs = options.fs || fs;
  }

  /**
   * Seals the dependencies. No more dependencies can be added once this is
   * called.
   * @return {this}
   */
  seal(): this {
    if (this.sealed) return this;
    this.sealed = true;
    this.dependencyMap.forEach((deps, referer) => {
      for (let i = 0; i < deps.length; i++) {
        // Build a unified set of dependencies for the entire tree
        /** @type {string} */
        let depRoot;
        if (deps[i].startsWith(this.rootDir + path.sep)) {
          depRoot = this.rootDir;
        } else {
          depRoot = path.parse(deps[i]).root;
        }
        let depsForRoot = this._getDepsForRoot(depRoot);
        depsForRoot.add(path.relative(depRoot, deps[i]));

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
    return this;
  }

  _getDepsForRoot(dir: string) {
    let depsForRoot = this.allDependencies.get(dir);
    if (!depsForRoot) {
      depsForRoot = new Set();
      this.allDependencies.set(dir, depsForRoot);
    }
    return depsForRoot;
  }

  unseal() {
    this.sealed = false;
    this.allDependencies.clear();
    this.fsTrees.clear();
  }

  countAll() {
    let num = 0;
    this.dependencyMap.forEach((deps) => {
      num += deps.length;
    });
    return num;
  }

  /**
   * Counts the number of unique dependencies.
   *
   * @returns {number}
   */
  countUnique() {
    if (!this.sealed) {
      throw new Error("Cannot count dependencies until after sealing them.");
    } else {
      return this.dependentsMap.size;
    }
  }

  /**
   * Set the dependencies for the file specified by `filePath`.
   *
   * @param filePath {string} relative path of the file that has dependencies.
   * @param dependencies {Array<string>} absolute or relative paths the file
   *   depends on. Relative paths are resolved relative to the directory
   *   containing the file that depends on them.
   */
  setDependencies(filePath: string, dependencies: Array<string>) {
    filePath = path.normalize(filePath);
    if (this.sealed) {
      throw new Error("Cannot set dependencies when sealed");
    }
    let absoluteDeps = new Array<string>();
    let fileDir = path.dirname(filePath);
    for (let i = 0; i < dependencies.length; i++) {
      let depPath = path.normalize(dependencies[i]);
      if (!path.isAbsolute(depPath)) {
        depPath = path.resolve(this.rootDir, fileDir, depPath);
      }
      absoluteDeps.push(depPath);
    }
    this.dependencyMap.set(filePath, absoluteDeps);
  }

  /**
   * Return a new, unsealed Dependencies that includes all the files and their
   * dependencies except for the files provided (and their dependencies) are
   * omitted.
   *
   * Note: this doesn't include the stat entries for the existing dependencies.
   *
   * @param files {Array<string>}
   * @returns {Dependencies}
   */
  copyWithout(files: Array<string>) {
    files = files.map(f => path.normalize(f));
    let newDeps = new Dependencies(this.rootDir, { fs: this.fs });
    for (let file of this.dependencyMap.keys()) {
      if (!files.includes(file)) {
        newDeps.setDependencies(file, this.dependencyMap.get(file)!);
      }
    }
    return newDeps;
  }

  /**
   * Get the dependency state and save it.
   * Dependencies must be sealed.
   * @returns {this}
   */
  captureDependencyState() {
    this.fsTrees = this.getDependencyState();
    return this;
  }

  /**
   * Compute dependencies state as fsTrees.
   * @returns {Map<string, FSTree<Entry> | FSHashTree>} an fs tree per filesystem root.
   */
  getDependencyState() {
    if (!this.sealed) {
      throw new Error("Cannot compute dependency state with unsealed dependencies.");
    }
    /** @type {Map<string, FSTree<Entry> | FSHashTree>} */
    let fsTrees = new Map();
    for (let fsRoot of this.allDependencies.keys()) {
      let dependencies = this.allDependencies.get(fsRoot)!;
      /** @type {FSTree<Entry> | FSHashTree} */
      let fsTree;
      if (fsRoot === this.rootDir) {
        fsTree = getHashTree(fsRoot, dependencies, this.fs);
      } else {
        fsTree = getStatTree(fsRoot, dependencies, this.fs);
      }
      fsTrees.set(fsRoot, fsTree);
    }
    return fsTrees;
  }

  /**
   * Returns the dependent files which have had a dependency change
   * since the last call to this method.
   * @returns {Array<string>} relative paths to the files that had a dependency change.
   */
  getInvalidatedFiles() {
    let invalidated = new Set<string>();
    let currentState = this.getDependencyState();
    for (let fsRoot of this.allDependencies.keys()) {
      let oldTree = this.fsTrees.get(fsRoot);
      if (!oldTree) throw new Error("internal error");
      let currentTree = currentState.get(fsRoot);
      let patch: FSTree.Patch;
      // typescript doesn't think these calculatePatch methods are the same
      // enough to call them from a single code path. I think it's a typescript
      // bug. the use of a type discriminator works around it.
      if (oldTree instanceof FSHashTree) {
        patch = oldTree.calculatePatch(currentTree);
      } else {
        patch = oldTree.calculatePatch(currentTree);
      }
      for (let operation of patch) {
        let depPath = path.join(fsRoot, operation[1]);
        let dependents = this.dependentsMap.get(depPath);
        if (!dependents) { continue; }
        for (let dep of dependents) {
          invalidated.add(dep);
        }
      }
    }
    this.fsTrees = currentState;
    return new Array(...invalidated);
  }

  /**
   * Serialize to a simple, JSON-friendly object containing only the
   * data necessary for deserializing.
   *
   * This object is serializable so it can be put into the persistent cache and
   * used to invalidate files during the next build in a new process.
   * @return {{rootDir: string, dependencies: {[k: string]: string[]}, fsTrees: Array<{fsRoot: string, entries: Array<{relativePath: string} & ({type: 'stat', size: number, mtime: number, mode: number} | {type: 'hash', hash: string})>}>}}
   */
  serialize(): SerializedDependencies {
    let dependencies: Record<string, Array<string>> = {};
    this.dependencyMap.forEach((deps, filePath) => {
      dependencies[filePath] = deps;
    });
    let fsTrees = new Array<SerializedTree>();
    for (let fsRoot of this.fsTrees.keys()) {
      let fsTree = this.fsTrees.get(fsRoot)!;
      /** @type {Array<{relativePath: string} & ({type: 'stat', size: number, mtime: number, mode: number} | {type: 'hash', hash: string})>} */
      let entries = new Array<SerializedEntry>();
      for (let entry of fsTree.entries) {
        if (entry instanceof HashEntry) {
          entries.push({
            type: "hash",
            relativePath: entry.relativePath,
            hash: entry.hash,
          });
        } else {
          entries.push({
            type: "stat",
            relativePath: entry.relativePath,
            size: entry.size!,
            mtime: +entry.mtime!,
            mode: entry.mode!
          });
        }
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
   * @param [newRootDir] {string | undefined}
   * @param customFS {typeof fs}. A customFS method to support fs facade change in broccoli-plugin.
   * @return {Dependencies};
   */
  static deserialize(dependencyData: SerializedDependencies, newRootDir: string, customFS: Dependencies.FSFacade) {
    let oldRootDir = dependencyData.rootDir;
    newRootDir = path.normalize(newRootDir || oldRootDir);
    let dependencies = new Dependencies(newRootDir, { fs: customFS });
    let files = Object.keys(dependencyData.dependencies);
    for (let file of files) {
      let deps = dependencyData.dependencies[file];
      if (newRootDir) {
        for (let i = 0; i < deps.length; i++) {
          let dep = deps[i];
          if (dep.startsWith(oldRootDir+path.sep)) {
            deps[i] = dep.replace(oldRootDir, newRootDir);
          }
        }
      }
      dependencies.setDependencies(file, deps);
    }
    let fsTrees = new Map<string, FSTree>();
    for (let fsTreeData of dependencyData.fsTrees) {
      let entries = new Array<Entry | HashEntry>();
      for (let entry of fsTreeData.entries) {
        if (entry.type === "stat") {
          entries.push(new Entry(entry.relativePath, entry.size, entry.mtime, entry.mode));
        } else {
          entries.push(new HashEntry(entry.relativePath, entry.hash));
        }
      }
      let fsTree: FSTree | FSHashTree;
      let treeRoot: string;
      if (fsTreeData.fsRoot === oldRootDir) {
        treeRoot = newRootDir;
        fsTree = FSHashTree.fromHashEntries(entries, { sortAndExpand: true });
      } else {
        treeRoot = fsTreeData.fsRoot;
        fsTree = FSTree.fromEntries(entries, { sortAndExpand: true });
      }
      fsTrees.set(treeRoot, fsTree);
    }
    dependencies.seal();
    dependencies.fsTrees = fsTrees;
    return dependencies;
  }
}

export = Dependencies;

/**
 * Get an FSTree that uses content hashing information to compare files to
 * see if they have changed.
 *
 * @param fsRoot {string}
 * @param dependencies {Set<string>}
 * @return {FSHashTree}
 */
function getHashTree(fsRoot: string, dependencies: Set<string>, fs: Dependencies.FSFacade) {
  let entries = new Array<HashEntry>();
  for (let dependency of dependencies) {
    let fullPath = path.join(fsRoot, dependency);
    try {
      // it would be good if we could cache this and share it with
      // the read that accompanies `processString()` (if any).
      let contents;
      try {
        contents = fs.readFileSync(fullPath, "utf8");
      } catch (e) {
        contents = fs.readFileSync(dependency, "utf8");
      }
      let hash = md5sum(contents);
      entries.push(new HashEntry(dependency, hash));
    } catch(e) {
      entries.push(new HashEntry(dependency, ""));
    }
  }
  return FSHashTree.fromHashEntries(entries);
}

/**
 * Get an FSTree that uses fs.stat information to compare files to see
 * if they have changed.
 *
 * @param fsRoot {string}
 * @param dependencies {Set<string>}
 */
function getStatTree(fsRoot: string, dependencies: Set<string>, fs: Dependencies.FSFacade) {
  let entries = new Array<Entry>();
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
  return FSTree.fromEntries(entries, {sortAndExpand: true});
}
