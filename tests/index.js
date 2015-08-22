'use strict';

var path = require('path');
var expect = require('expect.js');
var broccoli = require('broccoli');
var walkSync = require('walk-sync');

require('mocha-jshint')();

var PersistentFilter = require('..');

var TestFilter = function TestFilter(inputTree, options) {
  PersistentFilter.call(this, inputTree, options);
};
TestFilter.prototype = Object.create(PersistentFilter.prototype);

TestFilter.prototype.baseDir = function baseDir() {
  return '../';
};

describe('broccoli-persistent-filter', function() {
  var builder;

  var fixturePath = path.join(__dirname, 'fixtures');

  var inputPath = path.join(fixturePath, 'dir');
  var filter = new TestFilter(inputPath);

  afterEach(function() {
    if (builder) {
      return builder.cleanup();
    }
  });

  it('cache is initialized', function() {
    expect(filter.cache).to.ok();
  });

  it('default `baseDir` implementation throws an Unimplemented Exception', function() {
    expect(function() {
      new PersistentFilter(inputPath);
    }).to.throwError(/Filter must implement prototype.baseDir/);
  });

  it('`cacheKey` returns correct second level file cache', function() {
    expect(filter.cacheKey()).to.eql('83af711ed4af4451aefed889ed728b04');
  });

  it('`cacheKeyProcessString` return correct first level file cache', function() {
    expect(filter.cacheKeyProcessString('foo-bar-baz', 'relative-path')).to.eql('4c43793687f9a7170a9149ad391cbf70');
  });

  it('filter properly reads file tree', function() {
    var tree = new TestFilter(inputPath, {
      extensions: ['*.*']
    });

    builder = new broccoli.Builder(tree);

    return builder.build()
      .then(function(results) {
        var outputPath = results.directory;
        var expected = [
          'root-file.txt',
          'subdir/',
          'subdir/subdir-test.css',
          'subdir/subdir-test.js',
          'subdir/subdir-test.txt'
        ];

        expect(walkSync(outputPath)).to.eql(expected);
      });
  });
});
