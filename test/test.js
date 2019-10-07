'use strict';
const chai = require('chai');
const expect = chai.expect;
const chaiAsPromised = require('chai-as-promised');
const sinonChai = require('sinon-chai');
const chaiFiles = require('chai-files');
const file = chaiFiles.file;
const co = require('co');
const heimdall = require('heimdalljs');

const { createBuilder, createTempDir } = require('broccoli-test-helper');

chai.use(chaiAsPromised);
chai.use(sinonChai);
chai.use(chaiFiles);

const sinon = require('sinon');

const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');
const Filter = require('../');
const rimraf = require('rimraf').sync;
const os = require('os');

const ReplaceFilter = require('./helpers/replacer');
const ReplaceAsyncFilter = require('./helpers/replacer-async');
const IncompleteFilter = require('./helpers/incomplete');
const MyFilter = require('./helpers/simple');
const Rot13Filter = require('./helpers/rot13');
const Rot13AsyncFilter = require('./helpers/rot13-async');
const Inliner = require('./helpers/inliner');

function millisecondsSince(time) {
  var delta = process.hrtime(time);
  return (delta[0] * 1e9 + delta[1]) / 1e6;
}


describe('Filter', function() {

  function write(relativePath, contents, _encoding) {
    let encoding = _encoding === undefined ? 'utf8' : _encoding;

    mkdirp.sync(path.dirname(relativePath));
    fs.writeFileSync(relativePath, contents, {
      encoding
    });
  }
  describe('basic smoke test', function () {
    let input;

    beforeEach(co.wrap(function* () {
      input = yield createTempDir();
      input.write({
        'a': {
          'README.md': 'Nicest cats in need of homes',
          'foo.js': 'Nicest dogs in need of homes',
          'bar': {
            'bar.js': 'Dogs... who needs dogs?'
          }
        },
        'dir-with-extensions': {
          'a': {
            'loader.js': {
              'loader.js': ''
            }
          }
        }
      });
    }));

    afterEach(co.wrap(function* () {
      yield input.dispose();
    }));

    it('throws if base Filter class is new-ed', function() {
      expect(() => new Filter('.')).to.throw(TypeError, /abstract class and must be sub-classed/);
    });

    it('throws if `processString` is not implemented', function() {
      expect(() => new IncompleteFilter('.').processString('foo', 'fake_path')).to.throw(Error, /must implement/);
    });

    it('processes files with extensions included in `extensions` list by default', function() {
     let filter = new MyFilter('.', { extensions: ['c', 'cc', 'js']});

      expect(filter.canProcessFile('foo.c')).to.equal(true);
      expect(filter.canProcessFile('test.js')).to.equal(true);
      expect(filter.canProcessFile('blob.cc')).to.equal(true);
      expect(filter.canProcessFile('twerp.rs')).to.equal(false);
    });

    it('getDestFilePath returns null for directories when extensions is null', function() {
      let inputPath = input.path();
      let filter = new MyFilter(inputPath, { extensions: null });
      filter.inputPaths = [inputPath];

      expect(filter.getDestFilePath('a/bar')).to.equal(null);
      expect(filter.getDestFilePath('a/bar/bar.js')).to.equal('a/bar/bar.js');
    });

    it('getDestFilePath returns null for directories with matching extensions', function() {
      let inputPath = path.join(input.path(), 'dir-with-extensions');
      let filter = new MyFilter(inputPath, { extensions: ['js'] });
      filter.inputPaths = [inputPath];

      expect(filter.getDestFilePath('a/loader.js')).to.equal(null);
      expect(filter.getDestFilePath('a/loader.js/loader.js')).to.equal('a/loader.js/loader.js');
    });

    it('replaces matched extension with targetExtension by default', function() {
      let filter = new MyFilter('.', {
        extensions: ['c', 'cc', 'js'],
        targetExtension: 'zebra'
      });

      expect(filter.getDestFilePath('foo.c')).to.equal('foo.zebra');
      expect(filter.getDestFilePath('test.js')).to.equal('test.zebra');
      expect(filter.getDestFilePath('blob.cc')).to.equal('blob.zebra');
      expect(filter.getDestFilePath('twerp.rs')).to.equal(null);
    });
  });

  describe('on rebuild', function() {
    let input, subject, output;

    beforeEach(co.wrap(function* () {
      input = yield createTempDir();
      input.write({
        'a': {
          'README.md': 'Nicest cats in need of homes',
          'foo.js': 'Nicest dogs in need of homes',
          'bar': {
            'bar.js': 'Dogs... who needs dogs?'
          }
        }
      });
      subject = new Rot13Filter(input.path());
      sinon.spy(subject, 'processString');
      sinon.spy(subject, 'postProcess');
      output = createBuilder(subject);
    }));

    afterEach(co.wrap(function* () {
      yield input.dispose();
      yield output.dispose();
    }));

    it('calls processString a if work is needed', co.wrap(function* () {

      yield output.build();
      // first time, build everything
      expect(subject.processString.callCount).to.equal(3);
      expect(subject.postProcess.callCount).to.equal(3);

      subject.processString.callCount = 0;
      subject.postProcess.callCount = 0;

      yield output.build();

      // rebuild, but no changes (build nothing);
      expect(subject.processString.callCount).to.equal(0);
      expect(subject.postProcess.callCount).to.equal(0);

      input.write({
        'a': {
          'README.md': 'OMG 2'
        }
      });

      yield output.build();
      // rebuild 1 file
      expect(subject.processString.callCount).to.equal(1);
      expect(subject.postProcess.callCount).to.equal(1);

      subject.postProcess.callCount = 0;
      subject.processString.callCount = 0;

      input.write({
        'a': { 'README.md': null }
      });

      yield output.build();
      // rebuild 0 files
      expect(subject.processString.callCount).to.equal(0);
      expect(subject.postProcess.callCount).to.equal(0);
    }));

    describe('mid build failure', function() {
      let input;
      let output;
      let subject;

      class Plugin extends Filter {
        constructor(inputNode, options) {
          super(inputNode, options);
          this.shouldFail = true;
        }
      }
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
          'index.js': `console.log('hi')`
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
          'index.js': `console.log('hi')`
        });
      }));
    });

    describe('build failures - async', function() {

      let input;
      let output;
      let subject;

      class Plugin extends Filter {
        constructor(inputTree, options) {
          super(inputTree, options);
          this.shouldFail = true;
        }

        processString(content) {
          // every other file fails to build
          let shouldFail = this.shouldFail;
          this.shouldFail = !this.shouldFail;

          return new Promise((resolve, reject) => {
            setTimeout(() => {
              if (shouldFail) {
                reject('file failed for some reason');
              }
              else {
                resolve(content);
              }
            }, 50);
          });
        }
      }

      beforeEach(co.wrap(function* () {
        process.env.JOBS = '4';
        input = yield createTempDir();
        subject = new Plugin(input.path(), { async:true });
        output = createBuilder(subject);
      }));

      afterEach(co.wrap(function* () {
        delete process.env.JOBS;
        yield input.dispose();
        yield output.dispose();
      }));

      it('completes all pending work before returning', co.wrap(function* () {
        input.write({
          'index0.js': `console.log('hi')`,
          'index1.js': `console.log('hi')`,
          'index2.js': `console.log('hi')`,
          'index3.js': `console.log('hi')`,
        });

        let didFail = false;
        try {
          yield output.build();
        } catch(error) {
          didFail = true;
          expect(error.message).to.contain('file failed for some reason', 'error message text should match');
        }
        expect(didFail).to.eql(true, 'build should fail');
        expect(output.read(), 'should write the files that did not fail').to.deep.equal({
          'index1.js': `console.log('hi')`,
          'index3.js': `console.log('hi')`,
        });
      }));
    });

    it('calls processString if work is needed', co.wrap(function* () {
      const subject = new Rot13Filter(input.path(), {
        extensions: ['js'],
        targetExtension: 'OMG'
      });

      sinon.spy(subject, 'processString');
      output = createBuilder(subject);

      yield output.build();

      // first time, build everything
      expect(subject.processString.callCount).to.equal(2);
      subject.processString.callCount = 0;
      expect(output.changes()).to.deep.equal({
        'a/': 'mkdir',
        'a/README.md': 'create',
        'a/bar/': 'mkdir',
        'a/bar/bar.OMG': 'create',
        'a/foo.OMG': 'create'
      });

      yield output.build();

      // rebuild, but no changes (build nothing);
      expect(subject.processString.callCount).to.equal(0);

      input.write({
        a : {
          'README.md' : 'OMG'
        }
      });

      yield output.build();

      // rebuild 0 files, changed file does not match extensions
      expect(subject.processString.callCount).to.equal(0);
      subject.processString.callCount = 0;
      input.write({
        a : {
          'README.md' : null
        }
      });

      yield output.build();

      // rebuild 0 files
      expect(subject.processString.callCount).to.equal(0);
      input.write({
        fooo: {

        }
      });

      yield output.build();

      // rebuild, but no changes (build nothing);
      expect(subject.processString.callCount).to.equal(0);

      input.write({
        a: {
          'foo.js': 'OMG'
        }
      });

      yield output.build();

      // rebuild, but no changes (build nothing);
      expect(subject.processString.callCount).to.equal(1);
      expect(output.read()).to.deep.equal({
        'a': {
          'bar': {
            'bar.OMG': 'Qbtf... jub arrqf qbtf?'
          },
          'foo.OMG': 'BZT'
        },
        'fooo': {}
      });
    }));

    it('handles renames', co.wrap(function* () {
      const subject = new Rot13Filter(input.path(), {
        extensions: ['md'],
        targetExtension: ['foo.md']
      });

      sinon.spy(subject, 'processString');
      output = createBuilder(subject);
      yield output.build();

      // first time, build everything
      expect(subject.processString.callCount).to.equal(1);
      subject.processString.callCount = 0;
      input.write({
        a: {
          'README-renamed.md': 'Nicest cats in need of homes',
          'README.md': null
        }
      });

      yield output.build();

      expect(output.readDir()).to.eql([
        'a/',
        'a/README-renamed.foo.md',
        'a/bar/',
        'a/bar/bar.js',
        'a/foo.js'
      ]);
    }));

    it('preserves mtimes if neither content did not actually change', co.wrap(function* () {
      subject = new Rot13Filter(input.path(), {
        extensions: ['md']
      });
      sinon.spy(subject, 'processString');
      output = createBuilder(subject);
      let stat;
      let filePath;
      yield output.build();
      // first time, build everything
      expect(subject.processString.callCount).to.equal(1);
      subject.processString.callCount = 0;
      filePath = input.path('a/README.md');

      fs.writeFileSync(filePath, fs.readFileSync(filePath));
      stat = fs.statSync(filePath);

      yield output.build();

      let afterRebuildStat = fs.statSync(filePath);

      expect(subject.processString).to.have.been.calledOnce;
      // rebuild changed file
      expect(subject.processString).to.have.been.calledWith('Nicest cats in need of homes', 'a/README.md');

      // although file was 'rebuilt', no observable difference can be observed
      expect(stat.mode).to.equal(afterRebuildStat.mode);
      expect(stat.size).to.equal(afterRebuildStat.size);
      expect(stat.mtime.getTime()).to.equal(afterRebuildStat.mtime.getTime());
    }));
  });

  describe(`targetExtension`, function () {
    let input, subject, output;

    beforeEach(co.wrap(function* () {
      input = yield createTempDir();
      input.write({
        a: {
          'README.md': 'Nicest cats in need of homes',
          bar: {
            'bar.js': 'Dogs... who needs dogs?'
          },
          'foo.js': 'Nicest dogs in need of homes'
        }
      });
      subject = new Rot13Filter(input.path());
      sinon.spy(subject, 'processString');
      sinon.spy(subject, 'postProcess');
      output = createBuilder(subject);
    }));

    afterEach(co.wrap(function* () {
      yield input.dispose();
      yield output.dispose();
    }));
    it('targetExtension work for no extensions', co.wrap(function* () {
      const subject = new Rot13Filter(input.path(), {
        targetExtension: 'foo',
        extensions: []
      });
      sinon.spy(subject, 'processString');
      output = createBuilder(subject);
      yield output.build();
      expect(output.readText('a/README.md')).to.be.equal('Nicest cats in need of homes');
      expect(output.readText('a/foo.js')).to.be.equal('Nicest dogs in need of homes');
      expect(subject.processString.callCount).to.equal(0);
    }));

    it('targetExtension work for single extensions', co.wrap(function* () {
      const subject = new Rot13Filter(input.path(), {
        targetExtension: 'foo',
        extensions: ['js']
      });

      sinon.spy(subject, 'processString');
      output = createBuilder(subject);
      yield output.build();

      expect(output.readText('a/README.md')).to.equal('Nicest cats in need of homes');
      expect(output.readText('a/foo.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');
      expect(subject.processString.callCount).to.equal(2);

    }));

    it('targetExtension work for multiple extensions', co.wrap(function* () {
      const subject = new Rot13Filter(input.path(), {
        targetExtension: 'foo',
        extensions: ['js','md']
      });

      sinon.spy(subject, 'processString');
      output = createBuilder(subject);
      yield output.build();

      expect(output.readText('/a/README.foo')).to.equal('Avprfg pngf va arrq bs ubzrf');
      expect(output.readText('/a/foo.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');
      expect(subject.processString.callCount).to.equal(3);
    }));

    it('targetExtension work for multiple extensions - async', co.wrap(function* () {
      this.timeout(30*1000); // takes >10s when run with node 0.12
      let subject = new Rot13AsyncFilter(input.path(), {
        targetExtension: 'foo',
        extensions: ['js', 'md'],
        async: true,
      });
      let output = createBuilder(subject);

      yield output.build();

      expect(output.readText('a/README.foo')).to.equal('Avprfg pngf va arrq bs ubzrf');
      expect(output.readText('a/foo.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');
    }));

  });

  it('handles directories that older versions of walkSync do not sort lexicographically', co.wrap(function* () {
    let input = yield createTempDir();
    try {
      const subject = new Rot13Filter(input.path(), {
        targetExtension: 'foo',
        extensions: ['js']
      });

      input.write({
        foo: {
          'bar.js': 'Nicest dogs in need of homes'
        },
        'foo.md': 'Nicest dogs in need of homes'
      });

      sinon.spy(subject, 'processString');
      let output = createBuilder(subject);
      try {
        yield output.build();
        expect(output.readText('/foo.md')).to.equal('Nicest dogs in need of homes');
        expect(output.readText('foo/bar.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');

        expect(subject.processString.callCount).to.equal(1);
      } finally {
        yield output.dispose();
      }
    } finally {
      yield input.dispose();
    }
  }));

  describe(`processString, canPorcessFile and Purge cache`, function () {
    let input, output;

    beforeEach(co.wrap(function* () {
      input = yield createTempDir();
      input.write({
        a: {
          'README.md': 'Nicest cats in need of homes',
          bar: {
            'bar.js': 'Dogs... who needs dogs?'
          },
          'foo.js': 'Nicest dogs in need of homes'
        }
      });
    }));

    afterEach(co.wrap(function* () {
      yield input.dispose();
      yield output.dispose();
    }));

    it('should processString when canProcessFile returns true', co.wrap(function* () {
      const subject = new ReplaceFilter(input.path(), {
        glob: '**/*.md',
        search: 'dogs',
        replace: 'cats',
        targetExtension: 'foo'
      });
      sinon.spy(subject, 'processString');
      output = createBuilder(subject);
      yield output.build();
      expect(output.readText('/a/README.md')).to.equal('Nicest cats in need of homes');
      expect(output.readText('/a/foo.js')).to.equal('Nicest dogs in need of homes');
      expect(subject.processString.callCount).to.equal(1);
    }));

    it('should processString and postProcess', co.wrap(function* () {
        const subject = new ReplaceFilter(input.path(), {
          search: 'dogs',
          replace: 'cats'
        });

        subject.postProcess = function(object) {
          expect(object.output).to.exist;

          object.output = object.output + 0x00 + 'POST_PROCESSED!!';

          return object;
        };

        sinon.spy(subject, 'processString');
        sinon.spy(subject, 'postProcess');
        output = createBuilder(subject);
        yield output.build();
        expect(output.readText('/a/README.md')).to.equal('Nicest cats in need of homes' + 0x00 + 'POST_PROCESSED!!');
        expect(output.readText('/a/foo.js')).to.equal('Nicest cats in need of homes' + 0x00 + 'POST_PROCESSED!!');
        expect(subject.processString.callCount).to.equal(3);
        expect(subject.postProcess.callCount).to.equal(3);
    }));

    it('complains if canProcessFile is true but getDestFilePath is null', function () {
        const subject = new ReplaceFilter(input.path(), {
          glob: '**/*.md',
          search: 'dogs',
          replace: 'cats'
        });
        subject.canProcessFile = function() {
          // We cannot return `true` here unless `getDestFilePath` also returns
          // a path
          return true;
        };
        sinon.spy(subject, 'processString');
        sinon.spy(subject, 'postProcess');
        output = createBuilder(subject);
        expect(output.build()).to.eventually.be.rejectedWith(Error, /getDestFilePath.* is null/);
    });

    it('purges cache', co.wrap(function *() {
      const subject = new ReplaceFilter(input.path(), {
        glob: '**/*.md',
        search: 'dogs',
        replace: 'cats'
      });
      const output = createBuilder(subject);
      yield output.build();
      input.write({
        a: {
          'README.md': null
        }
      });
      expect(input.readDir()).to.not.includes('a/README.md');
      expect(output.readDir()).to.includes('a/README.md');
      yield output.build();
      expect(output.readDir()).to.not.includes('a/README.md');
      input.write({
        a: {
          'README.md': 'Nicest cats in need of homes'
        }
      });
      expect(input.readDir()).to.includes('a/README.md');
      yield output.build();
      expect(output.readDir()).to.includes('a/foo.js');
    }));
  });

  describe('stale entries', function () {
    let input, subject, output;

    beforeEach(co.wrap(function* () {
      input = yield createTempDir();
      input.write({
        a: {
          'README.md': 'Nicest cats in need of homes',
          bar: {
            'bar.js': 'Dogs... who needs dogs?'
          },
          'foo.js': 'Nicest dogs in need of homes'
        }
      });
      subject = new Rot13Filter(input.path());
      sinon.spy(subject, 'processString');
      sinon.spy(subject, 'postProcess');
      output = createBuilder(subject);
    }));

    afterEach(co.wrap(function* () {
      yield input.dispose();
      yield output.dispose();
    }));
    it('replaces stale entries', co.wrap(function* () {
      const subject = new ReplaceFilter(input.path(), {
        glob: '**/*.md',
        search: 'dogs',
        replace: 'cats'
      });

      let fileForChange = path.join(input.path(), 'a', 'README.md');
      const output = createBuilder(subject);
      yield output.build();
      input.write({
        a: {
          'README.md': 'such changes'
        }
      });
      yield output.build();
      expect(file(fileForChange)).to.exist;

      write(fileForChange, 'such changes');

      expect(file(fileForChange)).to.exist;

      yield output.build();

      expect(file(fileForChange)).to.exist;

      write(fileForChange, 'such changes');

      expect(file(fileForChange)).to.exist;
    }));

    it('replaces stale entries - async', co.wrap(function* () {
      let subject = new ReplaceAsyncFilter(input.path(), {
        glob: '**/*.md',
        search: 'cats',
        replace: 'dogs',
        async: true,
      });
      let fileForChange = path.join(input.path(), 'a', 'README.md');
      let output = createBuilder(subject);

      yield output.build();

      expect(output.readText('/a/README.md')).to.equal('Nicest dogs in need of homes');

      expect(file(fileForChange)).to.exist;

      input.write({
        a: {
          'README.md': 'such changes'
        }
      });

      expect(file(fileForChange)).to.exist;

      yield output.build();

      expect(output.readText('/a/README.md')).to.equal('such changes');
    }));


  });

  it('does not overwrite core options if they are not present', function() {
    class F extends Filter{
      constructor(inputTree, options) {
        super(inputTree, options);
      }
    }

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

  it('reports heimdall timing correctly for async work', co.wrap(function* () {
    let input = yield createTempDir();
    input.write({
      a: {
        'README.md': 'Nicest cats in need of homes',
        bar: {
          'bar.js': 'Dogs... who needs dogs?'
        },
        'foo.js': 'Nicest dogs in need of homes'
      }
    });
    heimdall._reset();
    let subject = new Rot13AsyncFilter(input.path(), {
      targetExtension: 'foo',
      extensions: ['js', 'md'],
      async: true,
    });
    let output = createBuilder(subject);

    yield output.build();

    var applyPatchesNode = heimdall.toJSON().nodes.filter(elem => elem.id.name === 'applyPatches')[0];
    var selfTime = applyPatchesNode.stats.time.self / (1000 * 1000); // convert to ms
    expect(selfTime).to.be.above(0, 'reported time should include the 50ms timeout in Rot13AsyncFilter');
  }));

  describe('persistent cache (delete process.env.CI)', function() {
    const hasCIValue = ('CI' in process.env);
    const CI_VALUE = process.env.CI;
    let input;

    class F extends Filter{
      constructor (inputTree, options) {
        super(inputTree, options);
      }
    }

    F.prototype.baseDir = function() {
      return path.join(__dirname, '../');
    };

    beforeEach(co.wrap(function* () {
      delete process.env.CI;
      this.originalCacheRoot = process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT;
      input = yield createTempDir();
      input.write({
        a: {
          'README.md': 'Nicest cats in need of homes',
          bar: {
            'bar.js': 'Dogs... who needs dogs?'
          },
          'foo.js': 'Nicest dogs in need of homes'
        }
      });
    }));

    afterEach(co.wrap(function* () {
      if (hasCIValue) {
        process.env.CI = CI_VALUE;
      } else{
        delete process.env.CI;
      }

      if (this.originalCacheRoot) {
        process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = this.originalCacheRoot;
      } else {
        delete process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT;
      }
      yield input.dispose();
    }));

    it('initializes cache', function() {
      this.timeout(15*1000); // takes >5s when run with node 0.12
      let f = new F(input.path(), {
        persist: true
      });

      // TODO: we should just deal in observable differences, not reaching into private state
      expect(f.processor.processor._cache).to.be.ok;

    });

    it('initializes cache using ENV variable if present', function() {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpdir(),
                                                                    'foo-bar-baz-testing-123');

      let f = new F(input.path(), {
        persist: true
      });

      // TODO: we should just deal in observable differences, not reaching into private state
      expect(f.processor.processor._cache.tmpdir).
        to.be.equal(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);
    });

    it('throws an UnimplementedException if the abstract `baseDir` implementation is used', function() {

      class F extends Filter{
        constructor (inputTree, options) {
          super(inputTree, options);
        }
      }

      expect(function() {
        new F(input.path(), { persist: true });
      }).to.throw(/Filter must implement prototype.baseDir/);
    });

    it('`cacheKeyProcessString` return correct first level file cache', function() {
      let f = new F(input.path(), { persist: true });

      expect(f.cacheKeyProcessString('foo-bar-baz', 'relative-path')).
        to.eql('272ebac734fa8949ba2aa803f332ec5b');
    });

    it('properly reads the file tree', co.wrap(function* () {
      const input = yield createTempDir();
      try {
        const subject = new ReplaceFilter(input.path(), {
          persist: true,
          glob: '**/*.md',
          search: 'dogs',
          replace: 'cats'
        });
        input.write({
          a: {
            'README.md': 'Nicest cats in need of homes',
            bar: {
              'bar.js': 'Dogs... who needs dogs?'
            },
            'foo.js': 'Nicest dogs in need of homes'
          }
        });
        const output = createBuilder(subject);
        try {
          yield output.build();
          expect(output.readDir()).to.deep.eql([
            'a/',
            'a/README.md',
            'a/bar/',
            'a/bar/bar.js',
            'a/foo.js'
          ]);
        }finally {
          yield output.dispose();
        }
      } finally {
        yield input.dispose();
      }
    }));

    it('calls postProcess for persistent cache hits (work is not needed)', co.wrap(function* () {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpdir(),
        'process-cache-string-tests');
      rimraf(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);
      const input = yield createTempDir();
      try {
        let subject = new ReplaceFilter(input.path(), {
          persist: true,
        });
        subject.postProcess = function(result) {
          expect(result.output).to.exist;
          return result;
        };
        sinon.spy(subject, 'processString');
        sinon.spy(subject, 'postProcess');
        input.write({
          a: {
            'README.md': 'Nicest cats in need of homes',
            bar: {
              'bar.js': 'Dogs... who needs dogs?'
            },
            'foo.js': 'Nicest dogs in need of homes'
          }
        });
        let output = createBuilder(subject);
        try {
          yield output.build();
          // first time, build everything
          expect(subject.processString.callCount).to.equal(3);
          expect(subject.postProcess.callCount).to.equal(3);
          subject = new ReplaceFilter(input.path(), {
            persist: true,
          });
          subject.postProcess = function(result) {
            expect(result.output).to.exist;
            return result;
          };
          sinon.spy(subject, 'processString');
          sinon.spy(subject, 'postProcess');
          output = createBuilder(subject);
          yield output.build();
          expect(subject.processString.callCount).to.equal(0);
          expect(subject.postProcess.callCount).to.equal(3);

        }finally {
          yield output.dispose();
        }
      } finally {
        yield input.dispose();
      }
    }));

    it('postProcess return value is not used', co.wrap(function* () {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpdir(),
        'process-cache-string-tests');
      rimraf(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);
      const input = yield createTempDir();
      try {
        let subject = new ReplaceFilter(input.path(), {
          persist: true,
        });
        subject.postProcess = function(result) {
          expect(result.output).to.exist;

          result.output = result.output + 0x00 + 'POST_PROCESSED!!';

          return Promise.resolve(result);
        };
        input.write({
          a: {
            'README.md': 'Nicest cats in need of homes',
            bar: {
              'bar.js': 'Dogs... who needs dogs?'
            },
            'foo.js': 'Nicest dogs in need of homes'
          }
        });
        let output = createBuilder(subject);
        try {
          yield output.build();
          expect(output.readText('/a/foo.js')).to.equal('Nicest dogs in need of homes' + 0x00 + 'POST_PROCESSED!!');
        }finally {
          yield output.dispose();
        }
      } finally {
        yield input.dispose();
      }
    }));
  });

  describe('persistent cache (process.env.CI=true)', function() {
    const hasCIValue = ('CI' in process.env);
    const CI_VALUE = process.env.CI;
    let input;

    class F extends Filter {
      constructor(inputTree, options) {
       super(inputTree, options);
      }
    }

    F.prototype.baseDir = function() {
      return path.join(__dirname, '../');
    };

    beforeEach(co.wrap(function* () {
      process.env.CI = true;
      this.originalCacheRoot = process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT;
      input = yield createTempDir();
      input.write({
        a: {
          'README.md': 'Nicest cats in need of homes',
          bar: {
            'bar.js': 'Dogs... who needs dogs?'
          },
          'foo.js': 'Nicest dogs in need of homes'
        }
      });
    }));

    afterEach(co.wrap(function* () {
      if (hasCIValue) {
        process.env.CI = CI_VALUE;
      } else{
        delete process.env.CI;
      }

      if (this.originalCacheRoot) {
        process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = this.originalCacheRoot;
      } else {
        delete process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT;
      }
      yield input.dispose();
    }));

    it('initializes cache', function() {
      let f = new F(input.path(), {
        persist: true
      });

      // TODO: we should just deal in observable differences, not reaching into private state
      expect(f.processor.processor._cache).to.eql(undefined);
    });

    it('calls postProcess for persistent cache hits (work is not needed)', co.wrap(function* () {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpdir(),
        'process-cache-string-tests');
      rimraf(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);

      let subject = new ReplaceFilter(input.path(), {
        persist: true,
      });
      subject.postProcess = function(result) {
        expect(result.output).to.exist;
        return result;
      };
      sinon.spy(subject, 'processString');
      sinon.spy(subject, 'postProcess');
      input.write({
        a: {
          'README.md': 'Nicest cats in need of homes',
          bar: {
            'bar.js': 'Dogs... who needs dogs?'
          },
          'foo.js': 'Nicest dogs in need of homes'
        }
      });
      let output = createBuilder(subject);
      yield output.build();
      // first time, build everything
      expect(subject.processString.callCount).to.equal(3);
      expect(subject.postProcess.callCount).to.equal(3);
      subject = new ReplaceFilter(input.path(), {
        persist: true,
      });
      subject.postProcess = function(result) {
        expect(result.output).to.exist;
        return result;
      };
      sinon.spy(subject, 'processString');
      sinon.spy(subject, 'postProcess');
      output = createBuilder(subject);
      yield output.build();
      expect(subject.processString.callCount).to.equal(3);
      yield output.dispose();
    }));
  });

  describe('processFile', function() {
    let input, subject, output;

    beforeEach(co.wrap(function* () {
      sinon.spy(fs, 'mkdirSync');
      sinon.spy(fs, 'writeFileSync');

      input = yield createTempDir();
      subject = new ReplaceFilter(input.path(), {
        search: 'dogs',
        replace: 'cats'
      });

      sinon.spy(subject, 'processString');
      sinon.spy(subject, 'postProcess');

      output = createBuilder(subject);
    }));

    afterEach(co.wrap(function* () {
      fs.mkdirSync.restore();
      fs.writeFileSync.restore();

      yield input.dispose();
      yield output.dispose();
    }));

    it('should work if `processString` returns a Promise', co.wrap(function* () {
      input.write({
        'foo.js': 'a promise is a promise'
      });

      yield output.build();

      expect(output.read()['foo.js']).to.equal('a promise is a promise');
    }));

    it('does not effect the current cwd', co.wrap(function* () {
      input.write({
        'a': {
          'foo.js': 'Nicest dogs in need of homes'
        }
      });

      yield output.build();

      let cwd = process.cwd();
      let a = path.join(cwd, 'a');

      expect(fs.mkdirSync.calledWith(a, 493)).to.eql(false);
      expect(fs.mkdirSync.calledWith(path.join(a, 'bar'), 493)).to.eql(false);

      expect(fs.writeFileSync.calledWith(path.join(cwd, 'a', 'foo.js'),
        'Nicest dogs in need of homes')).to.eql(false);

      yield output.build();

      expect(fs.writeFileSync.calledWith(path.join(cwd, 'a', 'foo.js'),
        'Nicest dogs in need of homes')).to.eql(false);
    }));

    it('does not accidentally write to symlinks it created', co.wrap(function* () {
      class Coffee extends Filter {
        processString(content) {
          return content;
        }
      }
      Coffee.prototype.extensions = ['coffee'];
      Coffee.prototype.targetExtension = 'js';
      subject = new Coffee(input.path(), { async:true });

      const ORIGINAL_FOO_JS = `console.log(\'Hello, World!\')`;

      input.write({
        'foo.js': ORIGINAL_FOO_JS
      });

      output = createBuilder(subject);

      yield output.build();

      expect(output.read()).to.eql({
        'foo.js': ORIGINAL_FOO_JS
      });

      input.write({
        'foo.coffee': '\'coffee source\''
      });

      yield output.build();

      expect(output.read()).to.eql({
        'foo.js': '\'coffee source\''
      });
      expect(input.read()['foo.js']).to.eql(ORIGINAL_FOO_JS);
    }));
  });

  describe('concurrency', function() {
    afterEach(function() {
      delete process.env.JOBS;
    });

    it('sets concurrency using environment variable', function() {
      process.env.JOBS = '12';
      let filter = new MyFilter('.', {});
      expect(filter.concurrency).to.equal(12);
    });

    it('sets concurrency using options.concurrency', function() {
      process.env.JOBS = '12';
      let filter = new MyFilter('.', { concurrency: 15 });
      expect(filter.concurrency).to.equal(15);
    });

    describe('CPU detection', function() {
      afterEach(function() {
        os.cpus.restore();
      });

      it('should set to detected CPUs - 1', function() {
        sinon.stub(os, 'cpus').callsFake(() => ['cpu0', 'cpu1', 'cpu2']);
        let filter = new MyFilter('.', {});
        expect(filter.concurrency).to.equal(2);
      });

      it('should have a min of 1', function() {
        sinon.stub(os, 'cpus').callsFake(() => []);
        let filter = new MyFilter('.', {});
        expect(filter.concurrency).to.equal(1);
      });
    });
  });

  describe('with dependency tracking', function() {
    let input, subject, output;

    afterEach(co.wrap(function* () {
      yield input.dispose();
      yield output.dispose();
    }));

    it('calls processString if work is needed', co.wrap(function* () {
      input = yield createTempDir();
      input.write({
        'dep-tracking': {
          'has-inlines.js': `// << ./local.js\n// << ../external-deps/external.js\n`,
          'local.js': `console.log('local');\n`,
          'unrelated-file.js': `console.log('pay me no mind.')\n`
        },
        'external-deps': {
          'external.js': `console.log('external');\n`
        }
      });

      subject = new Inliner(path.join(input.path(), 'dep-tracking'));
      sinon.spy(subject, 'processString');
      output = createBuilder(subject);

      let results = yield output.build();
      // first time, build everything
      expect(subject.processString.callCount).to.equal(3);

      expect(output.readText('has-inlines.js')).to.equal(
        `console.log('local');\n`+
        `console.log('external');\n`
      );

      subject.processString.callCount = 0;

      results = yield output.build();

      // rebuild, but no changes (build nothing);
      expect(subject.processString.callCount).to.equal(0);

      input.write({
        'dep-tracking': {
          'local.js': `console.log('local changed');\n`
        }
      });

      results = yield output.build();
      // rebuild 1 file
      expect(subject.processString.callCount).to.equal(2);

      expect(output.readText('has-inlines.js')).to.equal(
        `console.log('local changed');\n`+
        `console.log('external');\n`
      );

      subject.processString.callCount = 0;

      input.write({
        'dep-tracking': {
          'local.js': null,
          'has-inlines.js': `// << ../external-deps/external.js\n`
        }
      });


      results = yield output.build();
      // rebuild 1 files, make sure no error occurs from file deletion
      expect(subject.processString.callCount).to.equal(1);
      expect(output.readText('has-inlines.js')).to.equal(
        `console.log('external');\n`
      );
      subject.processString.callCount = 0;

      input.write({
        'external-deps': {
          'external.js': `console.log('external changed');\n`
        }
      });

      results = yield output.build();
      // rebuild 1 files, make sure changes outside the tree invalidate files.
      expect(subject.processString.callCount).to.equal(1);
      expect(output.readText('has-inlines.js')).to.equal(
        `console.log('external changed');\n`
      );
    }));
    describe('and with cache persistence', function () {
      const hasCIValue = ('CI' in process.env);
      const CI_VALUE = process.env.CI;

      beforeEach(function() {
        delete process.env.CI;
      });

      afterEach(function() {
        if (hasCIValue) {
          process.env.CI = CI_VALUE;
        } else{
          delete process.env.CI;
        }
      });

      it('calls processString if work is needed', co.wrap(function* () {
        input = yield createTempDir();
        input.write({
          'dep-tracking-1': {
            'has-inlines.js': `// << ./local.js\n// << ../external-deps/external.js\n`,
            'local.js': `console.log('local');\n`,
            'unrelated-file.js': `console.log('pay me no mind.')\n`
          },
          'dep-tracking-2': {
            'has-inlines.js': `// << ./local.js\n// << ../external-deps/external.js\n`,
            'local.js': `console.log('local changed');\n`,
            'unrelated-file.js': `console.log('pay me no mind.')\n`
          },
          'dep-tracking-3': {
            'has-inlines.js': `// << ../external-deps/external.js\n`,
            'local.js': null,
            'unrelated-file.js': `console.log('pay me no mind.')\n`
          },
          'external-deps': {
            'external.js': `console.log('external');\n`
          }
        });

        subject = new Inliner(path.join(input.path(), 'dep-tracking-1'), {
          persist: true
        });
        rimraf(subject.processor.processor._cache.root);
        rimraf(subject.processor.processor._syncCache.root);
        sinon.spy(subject, 'processString');
        output = createBuilder(subject);

        let results = yield output.build();
        // first time, build everything
        expect(output.readText('has-inlines.js')).to.equal(
          `console.log('local');\nconsole.log('external');\n`
        );
        expect(subject.processString.callCount).to.equal(3);


        subject.processString.callCount = 0;
        yield output.dispose();

        subject = new Inliner(path.join(input.path(), 'dep-tracking-1'), {
          persist: true
        });
        sinon.spy(subject, 'processString');
        output = createBuilder(subject);

        results = yield output.build();

        // rebuild, but no changes (build nothing);
        expect(subject.processString.callCount).to.equal(0);

        yield output.dispose();

        subject = new Inliner(path.join(input.path(), 'dep-tracking-2'), {
          persist: true
        });
        sinon.spy(subject, 'processString');
        output = createBuilder(subject);

        results = yield output.build();
        // rebuild 1 file due to invalidations, one due to changes.
        expect(subject.processString.callCount).to.equal(2);

        expect(output.readText('has-inlines.js')).to.equal(
          `console.log('local changed');\nconsole.log('external');\n`
        );

        subject.processString.callCount = 0;
        yield output.dispose();

        subject = new Inliner(path.join(input.path(), 'dep-tracking-3'), {
          persist: true
        });
        sinon.spy(subject, 'processString');
        output = createBuilder(subject);

        results = yield output.build();
        // rebuild 1 files, make sure no error occurs from file deletion
        expect(subject.processString.callCount).to.equal(1);
        expect(output.readText('has-inlines.js')).to.equal(
          `console.log('external');\n`
        );
        subject.processString.callCount = 0;
        yield output.dispose();

        subject = new Inliner(path.join(input.path(), 'dep-tracking-3'), {
          persist: true
        });
        sinon.spy(subject, 'processString');
        output = createBuilder(subject);

        input.write({
          'external-deps': {
            'external.js': `console.log('external changed');\n`
          }
        });

        results = yield output.build();
        // rebuild 1 files, make sure changes outside the tree invalidate files.
        expect(subject.processString.callCount).to.equal(1);
        expect(output.readText('has-inlines.js')).to.equal(
          `console.log('external changed');\n`
        );
      }));

    });
  });
});

describe('throttling', function() {
  let testHelpers = require('broccoli-test-helper');
  let createBuilder = testHelpers.createBuilder;
  let createTempDir = testHelpers.createTempDir;

  let input;
  let output;
  let subject;

  class Plugin extends Filter {
    constructor(inputTree, options) {
      super(inputTree, options);
      this.shouldFail = true;
    }

    processString(content) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(content);
        }, 100);
      });
    }
  }

  beforeEach(co.wrap(function* () {
    input = yield createTempDir();
    input.write({
      'index0.js': `console.log('hi')`,
      'index1.js': `console.log('hi')`,
      'index2.js': `console.log('hi')`,
      'index3.js': `console.log('hi')`,
    });
  }));

  afterEach(co.wrap(function* () {
    delete process.env.JOBS;
    expect(output.read(), 'all files should be written').to.deep.equal({
      'index0.js': `console.log('hi')`,
      'index1.js': `console.log('hi')`,
      'index2.js': `console.log('hi')`,
      'index3.js': `console.log('hi')`,
    });

    yield input.dispose();
    yield output.dispose();
  }));

  it('throttles operations to 1 concurrent job', co.wrap(function* () {
    process.env.JOBS = '1';
    subject = new Plugin(input.path(), { async:true });
    output = createBuilder(subject);
    expect(subject.concurrency).to.equal(1);

    var startTime = process.hrtime();

    yield output.build();

    expect(millisecondsSince(startTime)).to.be.above(400, '4 groups of 1 file each, taking 100ms each, should take at least 400ms');
  }));

  it('throttles operations to 2 concurrent jobs', co.wrap(function* () {
    process.env.JOBS = '2';
    subject = new Plugin(input.path(), { async:true });
    output = createBuilder(subject);
    expect(subject.concurrency).to.equal(2);

    var startTime = process.hrtime();

    yield output.build();

    expect(millisecondsSince(startTime)).to.be.above(200, '2 groups of 2 files each, taking 100ms each, should take at least 200ms');
  }));

  it('throttles operations to 4 concurrent jobs', co.wrap(function* () {
    process.env.JOBS = '4';
    subject = new Plugin(input.path(), { async:true });
    output = createBuilder(subject);
    expect(subject.concurrency).to.equal(4);

    var startTime = process.hrtime();

    yield output.build();

    expect(millisecondsSince(startTime)).to.be.above(100, '1 group of all 4 files, taking 100ms each, should take at least 100ms');
    expect(millisecondsSince(startTime)).to.be.below(200, 'all 4 jobs running concurrently in 1 group should finish in about 100ms');
  }));

});

