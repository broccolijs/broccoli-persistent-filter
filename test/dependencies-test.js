'use strict';
/// @ts-check

const path = require('path');
const fs = require('fs');
const assert = require('chai').assert;
const Dependencies = require('../lib/dependencies');
const url = require('url');
const resolveRelative = require('../lib/util/resolveRelative').default;
const FSMerger = require('fs-merger');

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
  if (root) {
    return path.resolve(root, filePath);
  } else {
    return path.normalize(filePath);
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

describe('relativePath utility', function() {
  it('resolves a relative path', function() {
    assert.equal(resolveRelative('.', 'foo.txt'), 'foo.txt');
  });
  it('resolves a relative path to a local directory', function() {
    assert.equal(resolveRelative('subdir', 'foo.txt'), path.normalize('subdir/foo.txt'));
  });
  it('resolves an absolute path', function() {
    assert.equal(resolveRelative('subdir', '/home/chris'), path.normalize('/home/chris'));
  });
  it('resolves against absolute path', function() {
    assert.equal(resolveRelative('subdir', '/home/chris', '../stef'), path.normalize('/home/stef'));
  });
  it('requires the first argument is relative', function() {
    assert.throws(() => {
      resolveRelative('/home/chris', '../stef')
    }, 'The first path must be relative. Got: /home/chris');
  });
  it('requires the first argument does not escape the local path', function() {
    assert.throws(() => {
      resolveRelative('../chris', 'node_modules')
    }, 'The first path cannot start outside the local root of the filesystem. Got: ../chris');
  });
  it('requires the first argument does not sneakily escape the local path', function() {
    assert.throws(() => {
      resolveRelative('foo/../../chris', 'node_modules')
    }, 'The first path cannot start outside the local root of the filesystem. Got: foo/../../chris');
  });
  it('requires the paths do not escape', function() {
    assert.throws(() => {
      resolveRelative('foo', '..', '..', 'chris', 'node_modules')
    }, 'Illegal path segment would cause the cumulative path to escape the local or global filesystem: ..');
  });
  it('requires the paths do not sneakily escape', function() {
    assert.throws(() => {
      resolveRelative('foo', 'bar/../../../chris/node_modules')
    }, 'Illegal path segment would cause the cumulative path to escape the local or global filesystem: bar/../../../chris/node_modules');
  });
  it('requires the paths do not sneakily escape by looking absolute', function() {
    assert.equal(resolveRelative('foo', '/bar/../../../chris/node_modules'), '/chris/node_modules');
  });
});

describe('Dependency Invalidation', function() {
  const DEP_FIXTURE_DIR = pathFor(__dirname, 'fixtures/dependencies');
  const EXT_DEP_FIXTURE_DIR = pathFor(__dirname, 'fixtures/dependencies-external');
  const FS_ROOT = path.parse(__dirname).root;
  const mergedFS = new FSMerger(DEP_FIXTURE_DIR).fs;

  it('allows relative dependencies', function() {
    let dependencies = new Dependencies(mergedFS);
    dependencies.setDependencies("file1.txt", [
      pathFor('subdir/subdirFile1.txt'),
      pathFor('subdir2/subdir2File1.txt'),
    ]);
    assert.deepEqual(dependencies.dependencyMap.get("file1.txt"), [
      [Dependencies.__LOCAL_ROOT, 'subdir/subdirFile1.txt'],
      [Dependencies.__LOCAL_ROOT, 'subdir2/subdir2File1.txt'],
    ]);
  });

  // This can happen when the plugin is using `plugin.inputPaths` and when
  // files are loaded from outside the broccoli tree.
  it('allows absolute dependencies', function() {
    let dependencies = new Dependencies(mergedFS);
    dependencies.setDependencies(pathFor('subdir/subdirFile1.txt'), [
      pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'),
      pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ]);
    assert.deepEqual(dependencies.dependencyMap.get(pathFor('subdir/subdirFile1.txt')).map(depWithTag => depWithTag[1]), [
      pathFor('subdir/subdirFile2.txt'),
      pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ]);
  });

  it('normalizes paths', function() {
    let dependencies = new Dependencies(new FSMerger(path.join(__dirname, 'fixtures', 'something', '..', 'dependencies')).fs); // always uses path.sep and contains a parent directory.
    dependencies.setDependencies('othersubdir/../subdir/subdirFile1.txt', [ // always passes unix paths and contains a parent directory.
      path.join(DEP_FIXTURE_DIR, 'thirdSubdir/../subdir/subdirFile2.txt'), // mixes windows and unix paths and has a parent directory.
      path.join(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ]);
    assert.deepEqual(dependencies.dependencyMap.get(pathFor('subdir/subdirFile1.txt')).map(depWithTag => depWithTag[1]), [
      pathFor('subdir/subdirFile2.txt'),
      pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ]);
  });

  // Discuss in code review:
  // This is a breaking change, but it might not be a breaking change in
  // practice. I don't use it in my code. I think it's weird to use relative
  // paths to escape the broccoli tree.
  it.skip('relative dependencies are relative to the file', function() {
    let dependencies = new Dependencies(DEP_FIXTURE_DIR);
    dependencies.setDependencies(pathFor('subdir/subdirFile1.txt'), [
      pathFor('subdirFile2.txt'),
      pathFor('../../dependencies-external/dep-1.txt') // Causes an exception now.
    ]);
    assert.deepEqual(dependencies.dependencyMap.get(pathFor('subdir/subdirFile1.txt')).map(depWithTag => depWithTag[1]), [
      pathFor(DEP_FIXTURE_DIR, 'subdir/subdirFile2.txt'),
      pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt')
    ]);
  });

  it('common dependencies are deduped', function () {
    let dependencies = new Dependencies(mergedFS);
    dependencies.setDependencies(pathFor('file1.txt'), [
      pathFor('subdir/subdirFile2.txt')
    ]);
    dependencies.setDependencies(pathFor('subdir/subdirFile1.txt'), [
      pathFor('subdirFile2.txt')
    ]);
    dependencies.seal();
    let deps = dependencies.allDependencies.get(Dependencies.__LOCAL_ROOT);
    assert.equal(deps.size, 1);
  });

  it('has a reverse lookup', function () {
    let dependencies = new Dependencies(mergedFS);
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
    let localdeps = dependencies.allDependencies.get(Dependencies.__LOCAL_ROOT);
    assert.equal(localdeps.size, 2);
    let dependents = dependencies.dependentsMap.get(pathFor('subdir/subdirFile1.txt'));
    assert.deepEqual(dependents, [pathFor('file1.txt')]);
    dependents = dependencies.dependentsMap.get(pathFor('subdir/subdirFile2.txt'));
    assert.deepEqual(dependents.sort(), [pathFor('file1.txt'), pathFor('subdir/subdirFile1.txt')].sort());
    dependents = dependencies.dependentsMap.get(pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt'));
    assert.deepEqual(dependents, [pathFor('subdir/subdirFile1.txt')]);
  });

  it('builds an FSTree', function () {
    let dependencies = new Dependencies(mergedFS);
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
    let localFileEntries = dependencies.fsTrees.get(Dependencies.__LOCAL_ROOT).entries.filter((e) => !e.isDirectory());
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
      let dependencies = new Dependencies(mergedFS);
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
    let dependencies = new Dependencies(mergedFS);
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
    assert.deepEqual(Object.keys(data), ['dependencies', 'fsTrees']);
    assert.deepEqual(data.dependencies, {
      'file1.txt': [
        pathFor('subdir/subdirFile1.txt'),
        pathFor('subdir/subdirFile2.txt'),
      ],
      [pathFor('subdir/subdirFile1.txt')]: [
        pathFor('subdir/subdirFile2.txt'),
        pathFor(EXT_DEP_FIXTURE_DIR, 'dep-1.txt'),
      ]
    });
    assert.deepEqual(data.fsTrees.length, 2);
    assert.deepEqual(data.fsTrees[0].fsRoot, {type: 'local'});
    assert.deepEqual(data.fsTrees[1].fsRoot, {type: 'external', rootDir: FS_ROOT});
    let localFileEntries = data.fsTrees[0].entries.filter((e) => !e.relativePath.endsWith('/'));
    assert.deepEqual(localFileEntries.length, 2);
    let fileEntries = data.fsTrees[1].entries.filter((e) => !e.relativePath.endsWith('/'));
    assert.deepEqual(fileEntries.length, 1);
    let json = JSON.stringify(data);
    let restoredDependencies = Dependencies.deserialize(JSON.parse(json), mergedFS, 'utf8');
    let invalidated = restoredDependencies.getInvalidatedFiles();
    assert.deepEqual(invalidated, []);
  });
});
