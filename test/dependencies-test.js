'use strict';
/// @ts-check

const path = require('path');
const fs = require('fs');
const assert = require('chai').assert;
const Dependencies = require('../lib/dependencies');
const url = require('url');

/**
 * @param root {string}
 * @param filePath {string}
 * @returns {string}
 */
function pathFor(root, filePath) {
  if (!filePath) {
    filePath = root;
    root = undefined;
  }
  filePath = filePath.split("/").join(path.sep);
  if (root) {
    return path.normalize(path.resolve(root, filePath));
  } else {
    return filePath;
  }
}

/**
 * @param filePath {string}
 * @param [contents] {string}
 */
function touch(filePath, contents) {
  if (contents) {
    let fd = fs.openSync(filePath, 'a');
    if (contents) {
      fs.writeSync(fd, contents);
    }
    fs.closeSync(fd);
  } else {
    let stats = fs.statSync(filePath);
    fs.utimesSync(filePath, stats.atime, new Date());
    stats = fs.statSync(filePath);
  }
}

describe('Dependency Invalidation', function() {
  const DEP_FIXTURE_DIR = pathFor(__dirname, 'fixtures/dependencies');
  const EXT_DEP_FIXTURE_DIR = pathFor(__dirname, 'fixtures/dependencies-external');
  const FS_ROOT = path.parse(__dirname).root;

  it('allows relative dependencies', function() {
    let dependencies = new Dependencies(DEP_FIXTURE_DIR);
    dependencies.setDependencies("file1.txt", [
      pathFor('subdir/subdirFile1.txt'),
      pathFor('subdir2/subdir2File1.txt'),
    ]);
    assert.deepEqual(dependencies.dependencyMap.get("file1.txt"), [
      pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile1.txt'),
      pathFor(DEP_FIXTURE_DIR, 'subdir2/subdir2File1.txt'),
    ]);
  });

  it('allows absolute dependencies', function() {
    let dependencies = new Dependencies(DEP_FIXTURE_DIR);
    dependencies.setDependencies(pathFor('subdir/subdirFile1.txt'), [
      pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'),
      pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ]);
    assert.deepEqual(dependencies.dependencyMap.get(pathFor('subdir/subdirFile1.txt')), [
      pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'),
      pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ]);
  });

  it('relative dependencies are relative to the file', function() {
    let dependencies = new Dependencies(DEP_FIXTURE_DIR);
    dependencies.setDependencies(pathFor('subdir/subdirFile1.txt'), [
      pathFor('subdirFile2.txt'),
      pathFor('../../dependencies-external/dep-1.txt')
    ]);
    assert.deepEqual(dependencies.dependencyMap.get(pathFor('subdir/subdirFile1.txt')), [
      pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'),
      pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ]);
  });

  it('common dependencies are deduped', function () {
    let dependencies = new Dependencies(DEP_FIXTURE_DIR);
    dependencies.setDependencies(pathFor('file1.txt'), [
      pathFor('subdir/subdirFile2.txt')
    ]);
    dependencies.setDependencies(pathFor('subdir/subdirFile1.txt'), [
      pathFor('subdirFile2.txt')
    ]);
    dependencies.seal();
    let deps = dependencies.allDependencies.get(DEP_FIXTURE_DIR);
    assert.equal(deps.size, 1);
  });

  it('has a reverse lookup', function () {
    let dependencies = new Dependencies(DEP_FIXTURE_DIR);
    dependencies.setDependencies(pathFor('file1.txt'), [
      pathFor('subdir/subdirFile1.txt'),
      pathFor('subdir/subdirFile2.txt')
    ]);
    dependencies.setDependencies(pathFor('subdir/subdirFile1.txt'), [
      pathFor('subdirFile2.txt'),
      pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ]);
    dependencies.seal();
    let deps = dependencies.allDependencies.get(FS_ROOT);
    assert.equal(deps.size, 1);
    let localdeps = dependencies.allDependencies.get(DEP_FIXTURE_DIR);
    assert.equal(localdeps.size, 2);
    let dependents = dependencies.dependentsMap.get(pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile1.txt'));
    assert.deepEqual(dependents, [pathFor('file1.txt')]);
    dependents = dependencies.dependentsMap.get(pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'));
    assert.deepEqual(dependents.sort(), [pathFor('file1.txt'), pathFor('subdir/subdirFile1.txt')].sort());
    dependents = dependencies.dependentsMap.get(pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt'));
    assert.deepEqual(dependents, [pathFor('subdir/subdirFile1.txt')]);
  });

  it('builds an FSTree', function () {
    let dependencies = new Dependencies(DEP_FIXTURE_DIR);
    dependencies.setDependencies(pathFor('file1.txt'), [
      pathFor('subdir/subdirFile1.txt'),
      pathFor('subdir/subdirFile2.txt')
    ]);
    dependencies.setDependencies(pathFor('subdir/subdirFile1.txt'), [
      pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'),
      pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ]);
    dependencies.seal();
    dependencies.captureDependencyState();
    let fileEntries = dependencies.fsTrees.get(FS_ROOT).entries.filter((e) => !e.isDirectory());
    assert.equal(1, fileEntries.length);
    let localFileEntries = dependencies.fsTrees.get(DEP_FIXTURE_DIR).entries.filter((e) => !e.isDirectory());
    assert.equal(2, localFileEntries.length);
    let paths = fileEntries.map(e => path.resolve(FS_ROOT, e.relativePath));
    assert.deepEqual(paths.sort(), [
      pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ].sort())
    let localPaths = localFileEntries.map(e => path.resolve(DEP_FIXTURE_DIR, e.relativePath));
    assert.deepEqual(localPaths.sort(), [
      pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile1.txt'),
      pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'),
    ].sort())
  });

  it('can compute invalidations', function () {
    let transientFile = pathFor(DEP_FIXTURE_DIR, 'subdir/tmpFile1.txt');
    try {
      touch(transientFile, "transient\n");
      let dependencies = new Dependencies(DEP_FIXTURE_DIR);
      dependencies.setDependencies(pathFor('file1.txt'), [
        pathFor('subdir/subdirFile1.txt'),
        pathFor('subdir/subdirFile2.txt'),
        pathFor('subdir/tmpFile1.txt'),
        pathFor(EXT_DEP_FIXTURE_DIR, 'dep-2.txt')
      ]);
      dependencies.setDependencies(pathFor('subdir/subdirFile1.txt'), [
        pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'),
        pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt'),
        pathFor(EXT_DEP_FIXTURE_DIR, 'dep-2.txt')
      ]);
      dependencies.seal();
      dependencies.captureDependencyState();

      // If nothing has changed, no files are invalidated
      let invalidated = dependencies.getInvalidatedFiles();
      assert.deepEqual(invalidated, []);

      // a timestamp change doesn't invalidate a local path
      touch(pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile1.txt'));
      invalidated = dependencies.getInvalidatedFiles();
      assert.deepEqual(invalidated, []);

      // in the local directory tree, content changes cause invalidation
      touch(transientFile, "added stuff\n");
      invalidated = dependencies.getInvalidatedFiles();
      assert.deepEqual(invalidated, [
        pathFor('file1.txt')
      ]);

      // Invalidations are reset after each call
      invalidated = dependencies.getInvalidatedFiles();
      assert.deepEqual(invalidated, []);

      // in external directories timestamp invalidation is used.
      touch(pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt'));
      invalidated = dependencies.getInvalidatedFiles();
      assert.deepEqual(invalidated, [
        pathFor('subdir/subdirFile1.txt'),
      ]);

      // if there's several dependent files, all are invalidated
      touch(pathFor(EXT_DEP_FIXTURE_DIR, 'dep-2.txt'));
      invalidated = dependencies.getInvalidatedFiles();
      assert.deepEqual(invalidated.sort(), [
        pathFor('file1.txt'),
        pathFor('subdir/subdirFile1.txt')
      ].sort());
    } finally {
      fs.unlinkSync(transientFile);
    }
  })

  it('can serialize and deserialize', function () {
    let dependencies = new Dependencies(DEP_FIXTURE_DIR);
    dependencies.setDependencies(pathFor('file1.txt'), [
      pathFor('subdir/subdirFile1.txt'),
      pathFor('subdir/subdirFile2.txt'),
    ]);
    dependencies.setDependencies(pathFor('subdir/subdirFile1.txt'), [
      pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'),
      pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ]);
    dependencies.seal();
    dependencies.captureDependencyState();
    let data = dependencies.serialize();
    assert.deepEqual(Object.keys(data), ['rootDir', 'dependencies', 'fsTrees']);
    assert.deepEqual(data.dependencies, {
      'file1.txt': [
        pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile1.txt'),
        pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'),
      ],
      'subdir/subdirFile1.txt': [
        pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'),
        pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt'),
      ]
    });
    assert.deepEqual(data.fsTrees.length, 2);
    assert.deepEqual(data.fsTrees[0].fsRoot, DEP_FIXTURE_DIR);
    assert.deepEqual(data.fsTrees[1].fsRoot, FS_ROOT);
    let localFileEntries = data.fsTrees[0].entries.filter((e) => !e.relativePath.endsWith('/'));
    assert.deepEqual(localFileEntries.length, 2);
    let fileEntries = data.fsTrees[1].entries.filter((e) => !e.relativePath.endsWith('/'));
    assert.deepEqual(fileEntries.length, 1);
    let json = JSON.stringify(data);
    let restoredDependencies = Dependencies.deserialize(JSON.parse(json));
    let invalidated = restoredDependencies.getInvalidatedFiles();
    assert.deepEqual(invalidated, []);
  });
});
