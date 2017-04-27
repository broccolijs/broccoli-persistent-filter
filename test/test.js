'use strict';

const chai = require('chai');
const expect = chai.expect;
const chaiAsPromised = require('chai-as-promised');
const sinonChai = require('sinon-chai');
const chaiFiles = require('chai-files');
const file = chaiFiles.file;
const co = require('co');

chai.use(chaiAsPromised);
chai.use(sinonChai);
chai.use(chaiFiles);

const sinon = require('sinon');
const broccoliTestHelpers = require('broccoli-test-helpers');

const makeTestHelper = broccoliTestHelpers.makeTestHelper;
const cleanupBuilders = broccoliTestHelpers.cleanupBuilders;

const inherits = require('util').inherits;
const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');
const Filter = require('../');
const rimraf = require('rimraf').sync;
const os = require('os');

const ReplaceFilter = require('./helpers/replacer');
const IncompleteFilter = require('./helpers/incomplete');
const MyFilter = require('./helpers/simple');
const Rot13Filter = require('./helpers/rot13');

const rootFixturePath = path.join(__dirname, 'fixtures');

function fixturePath(relativePath) {
  return path.join(rootFixturePath, relativePath);
}


describe('Filter', function() {
  function makeBuilder(plugin, dir, prepSubject) {
    return makeTestHelper({
      subject: plugin,
      fixturePath: dir,
      prepSubject: prepSubject
    });
  }

  afterEach(function() {
    cleanupBuilders();
  });

  function write(relativePath, contents, _encoding) {
    let encoding = _encoding === undefined ? 'utf8' : _encoding;

    mkdirp.sync(path.dirname(relativePath));
    fs.writeFileSync(relativePath, contents, {
      encoding
    });
  }

  it('throws if called as a function', function() {
    expect(() => Filter()).to.throw(TypeError, /abstract class and must be sub-classed/);
  });

  it('throws if called on object which does not a child class of Filter', function() {
    expect(() => Filter.call({})).to.throw(TypeError, /abstract class and must be sub-classed/);
    expect(() => Filter.call([])).to.throw(TypeError, /abstract class and must be sub-classed/);
    expect(() => Filter.call(global)).to.throw(TypeError, /abstract class and must be sub-classed/);
  });

  it('throws if base Filter class is new-ed', function() {
    expect(() => new Filter()).to.throw(TypeError, /abstract class and must be sub-classed/);
  });

  it('throws if `processString` is not implemented', function() {
    expect(() => new IncompleteFilter('.').processString('foo', 'fake_path')).to.throw(Error, /must implement/);
  });

  it('processes files with extensions included in `extensions` list by default', function() {
   let filter = MyFilter('.', { extensions: ['c', 'cc', 'js']});

    expect(filter.canProcessFile('foo.c')).to.equal(true);
    expect(filter.canProcessFile('test.js')).to.equal(true);
    expect(filter.canProcessFile('blob.cc')).to.equal(true);
    expect(filter.canProcessFile('twerp.rs')).to.equal(false);
  });

  it('replaces matched extension with targetExtension by default', function() {
    let filter = MyFilter('.', {
      extensions: ['c', 'cc', 'js'],
      targetExtension: 'zebra'
    });

    expect(filter.getDestFilePath('foo.c')).to.equal('foo.zebra');
    expect(filter.getDestFilePath('test.js')).to.equal('test.zebra');
    expect(filter.getDestFilePath('blob.cc')).to.equal('blob.zebra');
    expect(filter.getDestFilePath('twerp.rs')).to.equal(null);
  });

  describe('on rebuild', function() {
    it('calls processString a if work is needed', co.wrap(function* () {
      let builder = makeBuilder(Rot13Filter, fixturePath('a'), awk => {
        sinon.spy(awk, 'processString');
        sinon.spy(awk, 'postProcess');
        return awk;
      });
      let originalFileContent;
      let originalFilePath;
      let awk;

      try {
        let results = yield builder('dir');
        awk = results.subject;
        // first time, build everything
        expect(awk.processString.callCount).to.equal(3);
        expect(awk.postProcess.callCount).to.equal(3);
        awk.processString.callCount = 0;
        awk.postProcess.callCount = 0;
        results = yield results.builder();
        awk = results.subject;
        // rebuild, but no changes (build nothing);
        expect(awk.processString.callCount).to.equal(0);
        expect(awk.postProcess.callCount).to.equal(0);

        originalFilePath = awk.inputPaths[0] + '/a/README.md';
        originalFileContent = fs.readFileSync(originalFilePath);
        fs.writeFileSync(awk.inputPaths[0] + '/a/README.md', 'OMG');

        results = yield results.builder();
        awk = results.subject;
        // rebuild 1 file
        expect(awk.processString.callCount).to.equal(1);
        expect(awk.postProcess.callCount).to.equal(1);

        awk.postProcess.callCount = 0;
        awk.processString.callCount = 0;

        fs.unlinkSync(originalFilePath);

        results = yield results.builder();
        awk = results.subject;
        // rebuild 0 files
        expect(awk.processString.callCount).to.equal(0);
        expect(awk.postProcess.callCount).to.equal(0);

        awk.postProcess.callCount = 0;
      } finally {
        fs.writeFileSync(originalFilePath, originalFileContent);
      }
    }));

    describe('mid build failure', function() {
      let testHelpers = require('broccoli-test-helper');
      let createBuilder = testHelpers.createBuilder;
      let createTempDir = testHelpers.createTempDir;

      let input;
      let output;
      let subject;

      function Plugin(inputNode, options) {
        if (!this) {
          return new Plugin(inputNode, options);
        }

        this.shouldFail = true;
        Filter.call(this, inputNode, options);
      }

      inherits(Plugin, Filter);

      Plugin.prototype.processString = function(content) {
        let shouldFail = this.shouldFail;
        this.shouldFail = false;
        if (shouldFail) {
          throw new Error('first build happens to fail');
        }

        return content;
      };

      beforeEach(co.wrap(function* () {
        input = yield createTempDir();
        subject = new Plugin(input.path());
        output = createBuilder(subject);
      }));

      afterEach(co.wrap(function* () {
        yield input.dispose();
        yield output.dispose();
      }));

      it('works', co.wrap(function* () {
        input.write({
          'index.js': 'console.log("hi")'
        });

        let didFail = false;
        try {
          yield output.build();
        } catch(error) {
          didFail = true;
          expect(error.message).to.contain('first build happens to fail');
        }
        expect(didFail).to.eql(true);
        expect(output.read(), 'to be empty').to.deep.equal({});

        yield output.build();

        expect(output.read(), 'to no long be empty').to.deep.equal({
          'index.js': 'console.log("hi")'
        });
      }));
    });

    describe('with extensions & targetExtension', function() {
      it('calls processString if work is needed', co.wrap(function* () {
        let builder = makeBuilder(Rot13Filter, fixturePath('a'), awk => {
          sinon.spy(awk, 'processString');
          return awk;
        });
        let originalFileContent;
        let originalFilePath;
        let originalJSFileContent;
        let originalJSFilePath;
        let someDirPath;
        let awk;

        try {
          let results = yield builder('dir', {
            extensions: ['js'],
            targetExtension: 'OMG'
          });

          awk = results.subject;
          // first time, build everything
          expect(awk.processString.callCount).to.equal(2);
          awk.processString.callCount = 0;

          results = yield results.builder();

          awk = results.subject;
          // rebuild, but no changes (build nothing);
          expect(awk.processString.callCount).to.equal(0);

          originalFilePath = awk.inputPaths[0] + '/a/README.md';
          originalFileContent = fs.readFileSync(originalFilePath);
          fs.writeFileSync(originalFilePath, 'OMG');

          expect(file(results.directory + '/a/foo.OMG')).to.exist;

          results = yield results.builder();

          awk = results.subject;
          // rebuild 0 files, changed file does not match extensions
          expect(awk.processString.callCount).to.equal(0);
          awk.processString.callCount = 0;
          fs.unlinkSync(originalFilePath);

          results = yield results.builder();

          awk = results.subject;
          // rebuild 0 files
          expect(awk.processString.callCount).to.equal(0);
          someDirPath = awk.inputPaths[0] + '/fooo/';
          fs.mkdirSync(someDirPath);

          results = yield results.builder();

          awk = results.subject;
          // rebuild, but no changes (build nothing);
          expect(awk.processString.callCount).to.equal(0);

          originalJSFilePath = awk.inputPaths[0] + '/a/foo.js';
          originalJSFileContent = fs.readFileSync(originalJSFilePath);
          fs.writeFileSync(originalJSFilePath, 'OMG');

          results = yield results.builder();

          awk = results.subject;
          // rebuild, but no changes (build nothing);
          expect(awk.processString.callCount).to.equal(1);
          expect(fs.readFileSync(results.directory + '/a/foo.OMG', 'UTF-8')).to.eql('BZT');

          yield results.builder();

        } finally {
          try {
            fs.writeFileSync(originalFilePath, originalFileContent);
          } catch(e) { }
          try {
            fs.rmdirSync(someDirPath);
          } catch(e) { }

          try {
            fs.writeFileSync(originalJSFilePath, originalJSFileContent);
          } catch(e) { }
        }
      }));
    });

    it('handles renames', co.wrap(function* () {
      let builder = makeBuilder(Rot13Filter, fixturePath('a'), awk => {
        sinon.spy(awk, 'processString');
        return awk;
      });

      let filePathPrevious;
      let filePathNext;

      try {
        let results = yield builder('dir', {
          extensions: ['md'],
          targetExtension: ['foo.md']
        });

        let awk = results.subject;
        // first time, build everything
        expect(awk.processString.callCount).to.equal(1);
        awk.processString.callCount = 0;

        filePathPrevious = awk.inputPaths[0] + '/a/README.md';
        filePathNext = awk.inputPaths[0] + '/a/README-renamed.md';

        fs.writeFileSync(filePathNext, fs.readFileSync(filePathPrevious));
        fs.unlinkSync(filePathPrevious);

        results = yield results.builder();

        expect(results.files).to.eql([
          'a/',
          'a/README-renamed.foo.md',
          'a/bar/',
          'a/bar/bar.js',
          'a/foo.js'
        ]);
      } finally {
        fs.writeFileSync(filePathPrevious, fs.readFileSync(filePathNext));
        fs.unlinkSync(filePathNext);
      }
    }));

    it('preserves mtimes if neither content did not actually change', co.wrap(function* () {
      let builder = makeBuilder(Rot13Filter, fixturePath('a'), awk => {
        sinon.spy(awk, 'processString');
        return awk;
      });

      let stat;
      let filePath;

      let results = yield builder('dir', {
        extensions: ['md']
      });

      let awk = results.subject;
      // first time, build everything
      expect(awk.processString.callCount).to.equal(1);
      awk.processString.callCount = 0;
      filePath = awk.inputPaths[0] + '/a/README.md';

      fs.writeFileSync(filePath, fs.readFileSync(filePath));
      stat = fs.statSync(filePath);

      results = yield results.builder();

      awk = results.subject;
      let afterRebuildStat = fs.statSync(filePath);

      expect(awk.processString).to.have.been.calledOnce;
      // rebuild changed file
      expect(awk.processString).to.have.been.calledWith('Nicest cats in need of homes', 'a/README.md');

      // although file was "rebuilt", no observable difference can be observed
      expect(stat.mode).to.equal(afterRebuildStat.mode);
      expect(stat.size).to.equal(afterRebuildStat.size);
      expect(stat.mtime.getTime()).to.equal(afterRebuildStat.mtime.getTime());
    }));
  });

  it('targetExtension work for no extensions', co.wrap(function* () {
    let builder = makeBuilder(Rot13Filter, fixturePath('a'), awk => {
      sinon.spy(awk, 'processString');
      return awk;
    });

    let results = yield builder('dir', {
      targetExtension: 'foo',
      extensions: []
    });

    let awk = results.subject;

    expect(file(results.directory + '/a/README.md')).to.equal('Nicest cats in need of homes');
    expect(file(results.directory + '/a/foo.js')).to.equal('Nicest dogs in need of homes');

    expect(awk.processString.callCount).to.equal(0);
  }));

  it('targetExtension work for single extensions', co.wrap(function* () {
    let builder = makeBuilder(Rot13Filter, fixturePath('a'), awk => {
      sinon.spy(awk, 'processString');
      return awk;
    });

    let results = yield builder('dir', {
      targetExtension: 'foo',
      extensions: ['js']
    });

    let awk = results.subject;

    expect(file(results.directory + '/a/README.md')).to.equal('Nicest cats in need of homes');
    expect(file(results.directory + '/a/foo.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');

    expect(awk.processString.callCount).to.equal(2);
  }));

  it('targetExtension work for multiple extensions', co.wrap(function* () {
    let builder = makeBuilder(Rot13Filter, fixturePath('a'), awk => {
      sinon.spy(awk, 'processString');
      return awk;
    });

    let results = yield builder('dir', {
      targetExtension: 'foo',
      extensions: ['js','md']
    });

    let awk = results.subject;

    expect(file(results.directory + '/a/README.foo')).to.equal('Avprfg pngf va arrq bs ubzrf');
    expect(file(results.directory + '/a/foo.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');

    expect(awk.processString.callCount).to.equal(3);
  }));

  it('handles directories that older versions of walkSync do not sort lexicographically', co.wrap(function* () {
    let builder = makeBuilder(Rot13Filter, fixturePath('b'), awk => {
      sinon.spy(awk, 'processString');
      return awk;
    });

    let results = yield builder('dir', {
      targetExtension: 'foo',
      extensions: ['js']
    });

    let awk = results.subject;

    expect(file(results.directory + '/foo.md')).to.equal('Nicest cats in need of homes');
    expect(file(results.directory + '/foo/bar.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');

    expect(awk.processString.callCount).to.equal(1);
  }));

  it('should processString when canProcessFile returns true', co.wrap(function* () {
    let builder = makeBuilder(ReplaceFilter, fixturePath('a'), awk => {
      sinon.spy(awk, 'processString');
      return awk;
    });

    let results = yield builder('dir', {
      glob: '**/*.md',
      search: 'dogs',
      replace: 'cats',
      targetExtension: 'foo'
    });

    let awk = results.subject;

    expect(file(results.directory + '/a/README.md')).to.equal('Nicest cats in need of homes');
    expect(file(results.directory + '/a/foo.js')).to.equal('Nicest dogs in need of homes');
    expect(awk.processString.callCount).to.equal(1);
  }));

  it('should processString and postProcess', co.wrap(function* () {
    let builder = makeBuilder(ReplaceFilter, fixturePath('a'), awk => {
      awk.postProcess = function(object) {
        expect(object.output).to.exist;

        object.output = object.output + 0x00 + 'POST_PROCESSED!!';

        return object;
      };

      sinon.spy(awk, 'processString');
      sinon.spy(awk, 'postProcess');

      return awk;
    });

    let results = yield builder('dir', {
      search: 'dogs',
      replace: 'cats'
    });
    let awk = results.subject;

    expect(file(results.directory + '/a/README.md')).to.equal('Nicest cats in need of homes' + 0x00 + 'POST_PROCESSED!!');
    expect(file(results.directory + '/a/foo.js')).to.equal('Nicest cats in need of homes' + 0x00 + 'POST_PROCESSED!!');

    expect(awk.processString.callCount).to.equal(3);
    expect(awk.postProcess.callCount).to.equal(3);
  }));

  it('complains if canProcessFile is true but getDestFilePath is null', function() {
    let builder = makeBuilder(ReplaceFilter, fixturePath('a'), awk => {
      awk.canProcessFile = function() {
        // We cannot return `true` here unless `getDestFilePath` also returns
        // a path
        return true;
      };
      return awk;
    });

    return expect(builder('dir', {
      glob: '**/*.md',
      search: 'dogs',
      replace: 'cats'
    })).to.eventually.be.rejectedWith(Error, /getDestFilePath.* is null/);
  });

  it('purges cache', co.wrap(function *() {
    let builder = makeBuilder(ReplaceFilter, fixturePath('a'), awk => {
      return awk;
    });

    let fileForRemoval = path.join(fixturePath('a'), 'dir', 'a', 'README.md');

    let results = yield builder('dir', {
      glob: '**/*.md',
      search: 'dogs',
      replace: 'cats'
    });

    expect(file(fileForRemoval)).to.exist;
    rimraf(fileForRemoval);

    expect(file(fileForRemoval)).to.not.exist;
    expect(file(results.directory + '/a/README.md')).to.exist;

    results = yield results.builder();

    expect(file(results.directory + '/a/README.md')).to.not.exist;
    expect(file(fileForRemoval)).to.not.exist;

    write(fileForRemoval, 'Nicest cats in need of homes');
    expect(file(fileForRemoval)).to.exist;

    results = yield  results.builder();

    expect(file(results.directory + '/a/foo.js')).to.exist;
  }));

  it('replaces stale entries', co.wrap(function* () {
    let fileForChange = path.join(fixturePath('a'), 'dir', 'a', 'README.md');

    let builder = makeBuilder(ReplaceFilter, fixturePath('a'), awk => awk);

    let results = yield builder('dir', {
      glob: '**/*.md',
      search: 'dogs',
      replace: 'cats'
    });

    expect(file(fileForChange)).to.exist;

    write(fileForChange, 'such changes');

    expect(file(fileForChange)).to.exist;

    results = yield results.builder();

    expect(file(fileForChange)).to.exist;

    write(fileForChange, 'such changes');

    expect(file(fileForChange)).to.exist;

    write(fileForChange, 'Nicest cats in need of homes');
  }));

  it('does not overwrite core options if they are not present', function() {
    function F(inputTree, options) {
      Filter.call(this, inputTree, options);
    }

    inherits(F, Filter);

    F.prototype.extensions = ['js', 'rs'];
    F.prototype.targetExtension = 'glob';
    F.prototype.inputEncoding = 'latin1';
    F.prototype.outputEncoding = 'shift-jis';

    expect(new F('.').extensions).to.eql(['js', 'rs']);
    expect(new F('.').targetExtension).to.equal('glob');
    expect(new F('.').inputEncoding).to.equal('latin1');
    expect(new F('.').outputEncoding).to.equal('shift-jis');

    expect(new F('.', {
      extensions: ['x']
    }).extensions).to.eql(['x']);

    expect(new F('.', {
      targetExtension: 'c'
    }).targetExtension).to.equal('c');

    expect(new F('.', {
      inputEncoding: 'utf8'
    }).inputEncoding).to.equal('utf8');

    expect(new F('.', {
      outputEncoding: 'utf8'
    }).outputEncoding).to.equal('utf8');
  });

  describe('persistent cache', function() {
    function F(inputTree, options) {
      Filter.call(this, inputTree, options);
    }

    inherits(F, Filter);

    F.prototype.baseDir = function() {
      return path.join(__dirname, '../');
    };

    beforeEach(function() {
      this.originalCacheRoot = process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT;
    });

    afterEach(function() {
      if (this.originalCacheRoot) {
        process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = this.originalCacheRoot;
      } else {
        delete process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT;
      }
    });

    it('initializes cache', function() {
      let f = new F(fixturePath('a'), {
        persist: true
      });

      // TODO: we should just deal in observable differences, not reaching into private state
      expect(f.processor.processor._cache).to.be.ok;
    });

    it('initializes cache using ENV variable if present', function() {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpdir(),
                                                                    'foo-bar-baz-testing-123');

      let f = new F(fixturePath('a'), {
        persist: true
      });

      // TODO: we should just deal in observable differences, not reaching into private state
      expect(f.processor.processor._cache.tmpdir).
        to.be.equal(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);
    });

    it('throws an UnimplementedException if the abstract `baseDir` implementation is used', function() {

      function F(inputTree, options) {
        Filter.call(this, inputTree, options);
      }

      inherits(F, Filter);

      expect(function() {
        new F(fixturePath('a'), { persist: true });
      }).to.throw(/Filter must implement prototype.baseDir/);
    });

    it('`cacheKeyProcessString` return correct first level file cache', function() {
      let f = new F(fixturePath('a'), { persist: true });

      expect(f.cacheKeyProcessString('foo-bar-baz', 'relative-path')).
        to.eql('272ebac734fa8949ba2aa803f332ec5b');
    });

    it('properly reads the file tree', co.wrap(function* () {
      let builder = makeBuilder(ReplaceFilter, fixturePath('a'), awk => awk);

      let results = yield builder('dir', {
        persist: true,
        glob: '**/*.md',
        search: 'dogs',
        replace: 'cats'
      });

      expect(results.files).to.deep.eql([
        'a/',
        'a/README.md',
        'a/bar/',
        'a/bar/bar.js',
        'a/foo.js'
      ]);
    }));

    it('calls postProcess for persistent cache hits (work is not needed)', co.wrap(function* () {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpdir(),
        'process-cache-string-tests');
      rimraf(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);

      let builder = makeBuilder(ReplaceFilter, fixturePath('a'), awk => {
        awk.postProcess = function(result) {
          expect(result.output).to.exist;
          return result;
        };

        sinon.spy(awk, 'processString');
        sinon.spy(awk, 'postProcess');

        return awk;
      });

      let results = yield builder('dir', { persist: true });
      let awk = results.subject;

      // first time, build everything
      expect(awk.processString.callCount).to.equal(3);
      expect(awk.postProcess.callCount).to.equal(3);

      results = yield  builder('dir', { persist: true });
      awk = results.subject;
      // second instance, hits cache
      expect(awk.processString.callCount).to.equal(0);
      expect(awk.postProcess.callCount).to.equal(3);
    }));

    it('postProcess return value is not used', co.wrap(function* () {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpdir(),
        'process-cache-string-tests');
      rimraf(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);

      let builder = makeBuilder(ReplaceFilter, fixturePath('a'), awk => {
        awk.postProcess = function(result) {
          expect(result.output).to.exist;

          result.output = result.output + 0x00 + 'POST_PROCESSED!!';

          return Promise.resolve(result);
        };

        return awk;
      });

      yield builder('dir', { persist: true });
      // do nothing, just kicked off to warm the persistent cache
      let results = yield builder('dir', { persist: true });
      expect(file(results.directory + '/a/foo.js')).to.equal('Nicest dogs in need of homes' + 0x00 + 'POST_PROCESSED!!');
    }));
  });

  describe('processFile', function() {
    beforeEach(function() {
      sinon.spy(fs, 'mkdirSync');
      sinon.spy(fs, 'writeFileSync');
    });

    afterEach(function() {
      fs.mkdirSync.restore();
      fs.writeFileSync.restore();
    });

    it('should work if `processString` returns a Promise', co.wrap(function* () {
      let builder = makeBuilder(ReplaceFilter, fixturePath('a'), awk => {
        awk.processor.processString = function() {
          return Promise.resolve('a promise is a promise');
        };

        return awk;
      });

      let results = yield builder('dir', { persistent: true });
      expect(file(results.directory + '/a/foo.js')).to.equal('a promise is a promise');
    }));

    it('does not effect the current cwd', co.wrap(function* () {
      let builder = makeBuilder(ReplaceFilter, fixturePath('a'), awk => {
        sinon.spy(awk, 'canProcessFile');
        return awk;
      });

      let results = yield builder('dir', {
        glob: '**/*.js',
        search: 'dogs',
        replace: 'cats'
      });

      let a = path.join(process.cwd(), 'a');

      expect(fs.mkdirSync.calledWith(a, 493)).to.eql(false);
      expect(fs.mkdirSync.calledWith(path.join(a, 'bar'), 493)).to.eql(false);

      expect(fs.writeFileSync.calledWith(path.join(process.cwd(), 'a', 'foo.js'),
        'Nicest dogs in need of homes')).to.eql(false);

      yield results.builder();
      expect(fs.writeFileSync.calledWith(path.join(process.cwd(), 'a', 'foo.js'),
        'Nicest dogs in need of homes')).to.eql(false);
    }));
  });
});
