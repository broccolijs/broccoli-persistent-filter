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
 */
function touch(filePath) {
  fs.closeSync(fs.openSync(filePath, 'w'));
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
    let deps = dependencies.allDependencies.get(FS_ROOT);
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
    assert.equal(deps.size, 3);
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
    assert.equal(3, fileEntries.length);
    let paths = fileEntries.map(e => path.resolve(FS_ROOT, e.relativePath));
    assert.deepEqual(paths.sort(), [
      pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile1.txt'),
      pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'),
      pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ].sort())
  });

  it('can compute invalidations', function () {
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

    // If nothing has changed, no files are invalidated
    let invalidated = dependencies.getInvalidatedFiles();
    assert.deepEqual(invalidated, []);

    // only the dependent files are invalidated
    touch(pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile1.txt'));
    invalidated = dependencies.getInvalidatedFiles();
    assert.deepEqual(invalidated, [
      pathFor('file1.txt'),
    ]);

    // Invalidations are reset after each call
    invalidated = dependencies.getInvalidatedFiles();
    assert.deepEqual(invalidated, []);

    touch(pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt'));
    invalidated = dependencies.getInvalidatedFiles();
    assert.deepEqual(invalidated, [
      pathFor('subdir/subdirFile1.txt'),
    ]);

    // if there's several dependent files, all are invalidated
    touch(pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'));
    invalidated = dependencies.getInvalidatedFiles();
    assert.deepEqual(invalidated.sort(), [
      pathFor('file1.txt'),
      pathFor('subdir/subdirFile1.txt')
    ].sort());
  })

  it('can serialize and deserialize', function () {
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
    assert.deepEqual(data.fsTrees.length, 1);
    assert.deepEqual(data.fsTrees[0].fsRoot, FS_ROOT);
    let fileEntries = data.fsTrees[0].entries.filter((e) => !e.relativePath.endsWith('/'));
    assert.deepEqual(fileEntries.length, 3);
    let json = JSON.stringify(data);
    let restoredDependencies = Dependencies.deserialize(JSON.parse(json));
    let invalidated = restoredDependencies.getInvalidatedFiles();
    assert.deepEqual(invalidated, []);
  });
});
