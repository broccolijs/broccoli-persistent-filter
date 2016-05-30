'use strict';

var chai = require('chai');
var expect = chai.expect;
var chaiAsPromised = require('chai-as-promised');
var sinonChai = require('sinon-chai');
var chaiFiles = require('chai-files');
var file = chaiFiles.file;

chai.use(chaiAsPromised);
chai.use(sinonChai);
chai.use(chaiFiles);

var sinon = require('sinon');
var broccoliTestHelpers = require('broccoli-test-helpers');

var makeTestHelper = broccoliTestHelpers.makeTestHelper;
var cleanupBuilders = broccoliTestHelpers.cleanupBuilders;

var inherits = require('util').inherits;
var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');
var Filter = require('../');
var rimraf = require('rimraf').sync;
var os = require('os');
var Promise = require('rsvp').Promise;

var ReplaceFilter = require('./helpers/replacer');
var IncompleteFilter = require('./helpers/incomplete');
var MyFilter = require('./helpers/simple');
var Rot13Filter = require('./helpers/rot13');

var fixturePath = path.join(__dirname, 'fixtures');

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
    var encoding = _encoding === undefined ? 'utf8' : _encoding;

    mkdirp.sync(path.dirname(relativePath));
    fs.writeFileSync(relativePath, contents, {
      encoding: encoding
    });
  }

  it('throws if called as a function', function() {
    expect(function() {
      return Filter();
    }).to.throw(TypeError, /abstract class and must be sub-classed/);
  });

  it('throws if called on object which does not a child class of Filter', function() {
    expect(function() {
      return Filter.call({});
    }).to.throw(TypeError, /abstract class and must be sub-classed/);

    expect(function() {
      return Filter.call([]);
    }).to.throw(TypeError, /abstract class and must be sub-classed/);

    expect(function() {
      return Filter.call(global);
    }).to.throw(TypeError, /abstract class and must be sub-classed/);
  });

  it('throws if base Filter class is new-ed', function() {
    expect(function() {
      return new Filter();
    }).to.throw(TypeError, /abstract class and must be sub-classed/);
  });

  it('throws if `processString` is not implemented', function() {
    expect(function() {
      new IncompleteFilter('.').processString('foo', 'fake_path');
    }).to.throw(Error, /must implement/);
  });

  it('processes files with extensions included in `extensions` list by default', function() {

   var filter = MyFilter('.', { extensions: ['c', 'cc', 'js']});

    expect(filter.canProcessFile('foo.c')).to.equal(true);
    expect(filter.canProcessFile('test.js')).to.equal(true);
    expect(filter.canProcessFile('blob.cc')).to.equal(true);
    expect(filter.canProcessFile('twerp.rs')).to.equal(false);
  });

  it('replaces matched extension with targetExtension by default', function() {

    var filter = MyFilter('.', {
      extensions: ['c', 'cc', 'js'],
      targetExtension: 'zebra'
    });

    expect(filter.getDestFilePath('foo.c')).to.equal('foo.zebra');
    expect(filter.getDestFilePath('test.js')).to.equal('test.zebra');
    expect(filter.getDestFilePath('blob.cc')).to.equal('blob.zebra');
    expect(filter.getDestFilePath('twerp.rs')).to.equal(null);
  });

  describe('on rebuild', function() {
    it('calls processString only if work is needed', function() {
      var builder = makeBuilder(Rot13Filter, fixturePath, function(awk) {
        sinon.spy(awk, 'processString');
        sinon.spy(awk, 'postProcess');
        return awk;
      });
      var originalFileContent;
      var originalFilePath;

      return builder('dir').then(function(results) {
        var awk = results.subject;
        // first time, build everything
        expect(awk.processString.callCount).to.equal(3);
        expect(awk.postProcess.callCount).to.equal(3);
        awk.processString.callCount = 0;
        awk.postProcess.callCount = 0;
        return results.builder();
      }).then(function(results) {
        var awk = results.subject;
        // rebuild, but no changes (build nothing);
        expect(awk.processString.callCount).to.equal(0);
        expect(awk.postProcess.callCount).to.equal(0);

        originalFilePath = awk.inputPaths[0] + '/a/README.md';
        originalFileContent = fs.readFileSync(originalFilePath);
        fs.writeFileSync(awk.inputPaths[0] + '/a/README.md', 'OMG');

        return results.builder();
      }).then(function(results) {
        var awk = results.subject;
        // rebuild only 1 file
        expect(awk.processString.callCount).to.equal(1);
        expect(awk.postProcess.callCount).to.equal(1);

        awk.postProcess.callCount = 0;
        awk.processString.callCount = 0;

        fs.unlinkSync(originalFilePath);

        return results.builder();
      }).then(function(results) {
        var awk = results.subject;
        // rebuild only 0 files
        expect(awk.processString.callCount).to.equal(0);
        expect(awk.postProcess.callCount).to.equal(0);

        awk.postProcess.callCount = 0;
      }).finally(function() {
        fs.writeFileSync(originalFilePath, originalFileContent);
      });
    });

    describe('with extensions & targetExtension', function() {
      it('calls processString only if work is needed', function() {
        var builder = makeBuilder(Rot13Filter, fixturePath, function(awk) {
          sinon.spy(awk, 'processString');
          return awk;
        });
        var originalFileContent;
        var originalFilePath;
        var originalJSFileContent;
        var originalJSFilePath;
        var someDirPath;

        return builder('dir', {
          extensions: ['js'],
          targetExtension: 'OMG'
        }).then(function(results) {
          var awk = results.subject;
          // first time, build everything
          expect(awk.processString.callCount).to.equal(2);
          awk.processString.callCount = 0;
          return results.builder();
        }).then(function(results) {
          var awk = results.subject;
          // rebuild, but no changes (build nothing);
          expect(awk.processString.callCount).to.equal(0);

          originalFilePath = awk.inputPaths[0] + '/a/README.md';
          originalFileContent = fs.readFileSync(originalFilePath);
          fs.writeFileSync(originalFilePath, 'OMG');

          expect(file(results.directory + '/a/foo.OMG')).to.exist;

          return results.builder();
        }).then(function(results) {
          var awk = results.subject;
          // rebuild 0 files, changed file does not match extensions
          expect(awk.processString.callCount).to.equal(0);
          awk.processString.callCount = 0;

          fs.unlinkSync(originalFilePath);

          return results.builder();
        }).then(function(results) {
          var awk = results.subject;
          // rebuild only 0 files
          expect(awk.processString.callCount).to.equal(0);
          someDirPath = awk.inputPaths[0] + '/fooo/';
          fs.mkdir(someDirPath);
          return results.builder();
        }).then(function(results) {
          var awk = results.subject;
          // rebuild, but no changes (build nothing);
          expect(awk.processString.callCount).to.equal(0);

          originalJSFilePath = awk.inputPaths[0] + '/a/foo.js';
          originalJSFileContent = fs.readFileSync(originalJSFilePath);
          fs.writeFileSync(originalJSFilePath, 'OMG');

          return results.builder();
        }).then(function(results) {
          var awk = results.subject;
          // rebuild, but no changes (build nothing);
          expect(awk.processString.callCount).to.equal(1);
          expect(fs.readFileSync(results.directory + '/a/foo.OMG', 'UTF-8')).to.eql('BZT');

          return results.builder();
        }).finally(function() {
          try {
            fs.writeFileSync(originalFilePath, originalFileContent);
          } catch(e) { }
          try {
            fs.rmdir(someDirPath);
          } catch(e) { }

          try {
            fs.writeFileSync(originalJSFilePath, originalJSFileContent);
          } catch(e) { }
        });
      });
    });

    it('handles renames', function() {
      var builder = makeBuilder(Rot13Filter, fixturePath, function(awk) {
        sinon.spy(awk, 'processString');
        return awk;
      });

      var filePathPrevious;
      var filePathNext;

      return builder('dir', {
        extensions: ['md'],
        targetExtension: ['foo.md']
      }).then(function(results) {
        var awk = results.subject;
        // first time, build everything
        expect(awk.processString.callCount).to.equal(1);
        awk.processString.callCount = 0;

        filePathPrevious = awk.inputPaths[0] + '/a/README.md';
        filePathNext = awk.inputPaths[0] + '/a/README-renamed.md';

        fs.writeFileSync(filePathNext, fs.readFileSync(filePathPrevious));
        fs.unlinkSync(filePathPrevious);

        return results.builder();
      }).then(function(results) {
        expect(results.files).to.eql([
          'a/',
          'a/README-renamed.foo.md',
          'a/bar/',
          'a/bar/bar.js',
          'a/foo.js'
        ]);
      }).finally(function() {
        fs.writeFileSync(filePathPrevious, fs.readFileSync(filePathNext));
        fs.unlinkSync(filePathNext);
      });
    });

    it('preserves mtimes if neither content did not actually change', function() {
      var builder = makeBuilder(Rot13Filter, fixturePath, function(awk) {
        sinon.spy(awk, 'processString');
        return awk;
      });

      var stat;
      var filePath;

      return builder('dir', {
        extensions: ['md']
      }).then(function(results) {
        var awk = results.subject;
        // first time, build everything
        expect(awk.processString.callCount).to.equal(1);
        awk.processString.callCount = 0;
        filePath = awk.inputPaths[0] + '/a/README.md';

        fs.writeFileSync(filePath, fs.readFileSync(filePath));
        stat = fs.statSync(filePath);

        return results.builder();
      }).then(function(results) {
        var awk = results.subject;
        var afterRebuildStat = fs.statSync(filePath);

        expect(awk.processString).to.have.been.calledOnce;
        // rebuild changed file
        expect(awk.processString).to.have.been.calledWith('Nicest cats in need of homes', 'a/README.md');

        // although file was "rebuilt", no observable difference can be observed

        expect(stat.mode).to.equal(afterRebuildStat.mode);
        expect(stat.size).to.equal(afterRebuildStat.size);
        expect(stat.mtime.getTime()).to.equal(afterRebuildStat.mtime.getTime());
      });
    });
  });

  it('targetExtension work for no extensions', function() {
    var builder = makeBuilder(Rot13Filter, fixturePath, function(awk) {
      sinon.spy(awk, 'processString');
      return awk;
    });

    return builder('dir', {
      targetExtension: 'foo',
      extensions: []
    }).then(function(results) {
      var awk = results.subject;

      expect(file(results.directory + '/a/README.md')).to.equal('Nicest cats in need of homes');
      expect(file(results.directory + '/a/foo.js')).to.equal('Nicest dogs in need of homes');

      expect(awk.processString.callCount).to.equal(0);
    });
  });

  it('targetExtension work for single extensions', function() {
    var builder = makeBuilder(Rot13Filter, fixturePath, function(awk) {
      sinon.spy(awk, 'processString');
      return awk;
    });

    return builder('dir', {
      targetExtension: 'foo',
      extensions: ['js']
    }).then(function(results) {
      var awk = results.subject;

      expect(file(results.directory + '/a/README.md')).to.equal('Nicest cats in need of homes');
      expect(file(results.directory + '/a/foo.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');

      expect(awk.processString.callCount).to.equal(2);
    });
  });

  it('targetExtension work for multiple extensions', function() {
    var builder = makeBuilder(Rot13Filter, fixturePath, function(awk) {
      sinon.spy(awk, 'processString');
      return awk;
    });

    return builder('dir', {
      targetExtension: 'foo',
      extensions: ['js','md']
    }).then(function(results) {
      var awk = results.subject;

      expect(file(results.directory + '/a/README.foo')).to.equal('Avprfg pngf va arrq bs ubzrf');
      expect(file(results.directory + '/a/foo.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');

      expect(awk.processString.callCount).to.equal(3);
    });
  });

  it('should processString only when canProcessFile returns true', function() {

    var builder = makeBuilder(ReplaceFilter, fixturePath, function(awk) {
      sinon.spy(awk, 'processString');
      return awk;
    });

    return builder('dir', {
      glob: '**/*.md',
      search: 'dogs',
      replace: 'cats',
      targetExtension: 'foo'
    }).then(function(results) {
      var awk = results.subject;

      expect(file(results.directory + '/a/README.md')).to.equal('Nicest cats in need of homes');
      expect(file(results.directory + '/a/foo.js')).to.equal('Nicest dogs in need of homes');
      expect(awk.processString.callCount).to.equal(1);
    });
  });

  it('should processString and postProcess', function() {

    var builder = makeBuilder(ReplaceFilter, fixturePath, function(awk) {
      awk.postProcess = function(object) {
        expect(object.output).to.exist;

        object.output = object.output + 0x00 + 'POST_PROCESSED!!';

        return object;
      };

      sinon.spy(awk, 'processString');
      sinon.spy(awk, 'postProcess');

      return awk;
    });

    return builder('dir', {
      search: 'dogs',
      replace: 'cats'
    }).then(function(results) {
      var awk = results.subject;

      expect(file(results.directory + '/a/README.md')).to.equal('Nicest cats in need of homes' + 0x00 + 'POST_PROCESSED!!');
      expect(file(results.directory + '/a/foo.js')).to.equal('Nicest cats in need of homes' + 0x00 + 'POST_PROCESSED!!');

      expect(awk.processString.callCount).to.equal(3);
      expect(awk.postProcess.callCount).to.equal(3);
    });
  });

  it('complains if canProcessFile is true but getDestFilePath is null', function() {

    var builder = makeBuilder(ReplaceFilter, fixturePath, function(awk) {
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

  it('purges cache', function() {
    var builder = makeBuilder(ReplaceFilter, fixturePath, function(awk) {
      return awk;
    });

    var fileForRemoval = path.join(fixturePath, 'dir', 'a', 'README.md');

    return builder('dir', {
      glob: '**/*.md',
      search: 'dogs',
      replace: 'cats'
    }).then(function(results) {
      expect(file(fileForRemoval)).to.exist;
      rimraf(fileForRemoval);

      expect(file(fileForRemoval)).to.not.exist;
      expect(file(results.directory + '/a/README.md')).to.exist;

      return results.builder();
    }).then(function(results) {
      expect(file(results.directory + '/a/README.md')).to.not.exist;
      expect(file(fileForRemoval)).to.not.exist;
      return results;
    }).finally(function() {
      write(fileForRemoval, 'Nicest cats in need of homes');
    }).then(function(results) {
      expect(file(fileForRemoval)).to.exist;
      return results.builder();
    }).then(function(results) {
      expect(file(results.directory + '/a/foo.js')).to.exist;
    });
  });

  it('replaces stale entries', function() {
    var fileForChange = path.join(fixturePath, 'dir', 'a', 'README.md');

    var builder = makeBuilder(ReplaceFilter, fixturePath, function(awk) {
      return awk;
    });

    return builder('dir', {
      glob: '**/*.md',
      search: 'dogs',
      replace: 'cats'
    }).then(function(results) {
      expect(file(fileForChange)).to.exist;

      write(fileForChange, 'such changes');

      expect(file(fileForChange)).to.exist;

      return results.builder();
    }).then(function() {
      expect(file(fileForChange)).to.exist;

      write(fileForChange, 'such changes');

      expect(file(fileForChange)).to.exist;
    }).then(function() {
      write(fileForChange, 'Nicest cats in need of homes');
    });
  });

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
      inputEncoding: 'utf8'}
    ).inputEncoding).to.equal('utf8');

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
      var f = new F(fixturePath, {
        persist: true
      });

      // TODO: we should just deal in observable differences, not reaching into private state
      expect(f.processor.processor._cache).to.be.ok;
    });

    it('initializes cache using ENV variable if present', function() {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpDir(),
                                                                    'foo-bar-baz-testing-123');

      var f = new F(fixturePath, {
        persist: true
      });

      // TODO: we should just deal in observable differences, not reaching into private state
      expect(f.processor.processor._cache.tmpDir).
        to.be.equal(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);
    });

    it('throws an UnimplementedException if the abstract `baseDir` implementation is used', function() {

      function F(inputTree, options) {
        Filter.call(this, inputTree, options);
      }

      inherits(F, Filter);

      expect(function() {
        new F(fixturePath, { persist: true });
      }).to.throw(/Filter must implement prototype.baseDir/);
    });

    it('`cacheKeyProcessString` return correct first level file cache', function() {
      var f = new F(fixturePath, { persist: true });

      expect(f.cacheKeyProcessString('foo-bar-baz', 'relative-path')).
        to.eql('272ebac734fa8949ba2aa803f332ec5b');
    });

    it('properly reads the file tree', function() {
      var builder = makeBuilder(ReplaceFilter, fixturePath, function(awk) {
        return awk;
      });

      return builder('dir', {
        persist: true,
        glob: '**/*.md',
        search: 'dogs',
        replace: 'cats'
      }).then(function(results) {
        expect(results.files).to.deep.eql([
          'a/',
          'a/README.md',
          'a/bar/',
          'a/bar/bar.js',
          'a/foo.js'
        ]);
      });
    });

    it('calls postProcess for persistent cache hits (work is not needed)', function() {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpDir(),
                                                                    'process-cache-string-tests');
      rimraf(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);

      var builder = makeBuilder(ReplaceFilter, fixturePath, function(awk) {
        awk.postProcess = function(result) {
          expect(result.output).to.exist;
          return result;
        };

        sinon.spy(awk, 'processString');
        sinon.spy(awk, 'postProcess');

        return awk;
      });

      return builder('dir', { persist: true }).then(function(results) {
        var awk = results.subject;
        // first time, build everything
        expect(awk.processString.callCount).to.equal(3);
        expect(awk.postProcess.callCount).to.equal(3);
      }).then(function() {
        return builder('dir', { persist: true });
      }).then(function(results) {
        var awk = results.subject;
        // second instance, hits cache
        expect(awk.processString.callCount).to.equal(0);
        expect(awk.postProcess.callCount).to.equal(3);
      });
    });

    it('postProcess return value is not used', function() {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpDir(),
                                                                    'process-cache-string-tests');
      rimraf(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);

      var builder = makeBuilder(ReplaceFilter, fixturePath, function(awk) {
        awk.postProcess = function(result) {
          expect(result.output).to.exist;

          result.output = result.output + 0x00 + 'POST_PROCESSED!!';

          return Promise.resolve(result);
        };

        return awk;
      });

      return builder('dir', { persist: true }).then(function(results) {
        // do nothing, just kicked off to warm the persistent cache
      }).then(function() {
        return builder('dir', { persist: true });
      }).then(function(results) {
        expect(file(results.directory + '/a/foo.js')).to.equal('Nicest dogs in need of homes' + 0x00 + 'POST_PROCESSED!!');
      });
    });
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

    it('does not effect the current cwd', function() {
      var builder = makeBuilder(ReplaceFilter, fixturePath, function(awk) {
        sinon.spy(awk, 'canProcessFile');
        return awk;
      });

      return builder('dir', {
        glob: '**/*.js',
        search: 'dogs',
        replace: 'cats'
      }).then(function(results) {
        var a = path.join(process.cwd(), 'a');

        expect(fs.mkdirSync.calledWith(a, 493)).to.eql(false);
        expect(fs.mkdirSync.calledWith(path.join(a, 'bar'), 493)).to.eql(false);

        expect(fs.writeFileSync.calledWith(path.join(process.cwd(), 'a', 'foo.js'),
                                           'Nicest dogs in need of homes')).to.eql(false);

        return results.builder();
      }).then(function() {
        expect(fs.writeFileSync.calledWith(path.join(process.cwd(), 'a', 'foo.js'),
                                           'Nicest dogs in need of homes')).to.eql(false);
      });
    });
  });
});
