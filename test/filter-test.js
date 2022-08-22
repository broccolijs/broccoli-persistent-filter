'use strict';
const chai = require('chai');
const expect = chai.expect;
const chaiAsPromised = require('chai-as-promised');
const sinonChai = require('sinon-chai');
const chaiFiles = require('chai-files');
const file = chaiFiles.file;
const heimdall = require('heimdalljs');

const { createBuilder, createTempDir } = require('broccoli-test-helper');

chai.use(chaiAsPromised);
chai.use(sinonChai);
chai.use(chaiFiles);

const sinon = require('sinon');

const fs = require('fs');
const path = require('path');
const Filter = require('..');
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

    fs.mkdirSync(path.dirname(relativePath), { recursive: true });
    fs.writeFileSync(relativePath, contents, {
      encoding
    });
  }
  describe('basic smoke test', function () {
    let input, output;

    beforeEach(async function() {
      input = await createTempDir();
      input.write({
        'foo.c': '',
        'test.js': '',
        'blob.cc': '',
        'twerp.rs': '',
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
    });

    afterEach(async function() {
      await input.dispose();
    });

    it('throws if base Filter class is new-ed', function() {
      expect(() => new Filter(input.path())).to.throw(TypeError, /rather is intended to be sub-classed/);
    });

    it('throws if `processString` is not implemented', function() {
      expect(() => new IncompleteFilter(input.path()).processString('foo', 'fake_path')).to.throw(Error, /must implement/);
    });

    it('processes files with extensions included in `extensions` list by default', async function () {
     let filter = new MyFilter(input.path(), { extensions: ['c', 'cc', 'js']});

     output = createBuilder(filter);
     await output.build();

      expect(filter.canProcessFile('foo.c')).to.equal(true);
      expect(filter.canProcessFile('test.js')).to.equal(true);
      expect(filter.canProcessFile('blob.cc')).to.equal(true);
      expect(filter.canProcessFile('twerp.rs')).to.equal(false);
    });

    it('getDestFilePath handles non-existent (deleted/moved) files', async function () {
      let inputPath = input.path();
      let filter = new MyFilter(inputPath);

      output = createBuilder(filter);
      await output.build();

      expect(filter.getDestFilePath('non/existent/file.js')).to.equal('non/existent/file.js');
    });

    it('getDestFilePath returns null for directories when extensions is null', async function () {
      let inputPath = input.path();
      let filter = new MyFilter(inputPath, { extensions: null });

      output = createBuilder(filter);
      await output.build();

      expect(filter.getDestFilePath('a/bar')).to.equal(null);
      expect(filter.getDestFilePath('a/bar/bar.js')).to.equal('a/bar/bar.js');
    });

    it('getDestFilePath returns null for directories with matching extensions', async function () {
      let inputPath = path.join(input.path(), 'dir-with-extensions');
      let filter = new MyFilter(inputPath, { extensions: ['js'] });

      output = createBuilder(filter);
      await output.build();

      expect(filter.getDestFilePath('a/loader.js')).to.equal(null);
      expect(filter.getDestFilePath('a/loader.js/loader.js')).to.equal('a/loader.js/loader.js');
    });

    it('replaces matched extension with targetExtension by default', async function () {
      let filter = new MyFilter(input.path(), {
        extensions: ['c', 'cc', 'js'],
        targetExtension: 'zebra'
      });

      output = createBuilder(filter);
      await output.build();

      expect(filter.getDestFilePath('foo.c')).to.equal('foo.zebra');
      expect(filter.getDestFilePath('test.js')).to.equal('test.zebra');
      expect(filter.getDestFilePath('blob.cc')).to.equal('blob.zebra');
      expect(filter.getDestFilePath('twerp.rs')).to.equal(null);
    });
  });

  describe('on rebuild', function() {
    let input, subject, output;

    beforeEach(async function() {
      input = await createTempDir();
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
    });

    afterEach(async function() {
      await input.dispose();
      await output.dispose();
    });

    it('calls processString a if work is needed', async function() {

      await output.build();
      // first time, build everything
      expect(subject.processString.callCount).to.equal(3);
      expect(subject.postProcess.callCount).to.equal(3);

      subject.processString.callCount = 0;
      subject.postProcess.callCount = 0;

      await output.build();

      // rebuild, but no changes (build nothing);
      expect(subject.processString.callCount).to.equal(0);
      expect(subject.postProcess.callCount).to.equal(0);

      input.write({
        'a': {
          'README.md': 'OMG 2'
        }
      });

      await output.build();
      // rebuild 1 file
      expect(subject.processString.callCount).to.equal(1);
      expect(subject.postProcess.callCount).to.equal(1);

      subject.postProcess.callCount = 0;
      subject.processString.callCount = 0;

      input.write({
        'a': { 'README.md': null }
      });

      await output.build();
      // rebuild 0 files
      expect(subject.processString.callCount).to.equal(0);
      expect(subject.postProcess.callCount).to.equal(0);
    });

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

      beforeEach(async function() {
        input = await createTempDir();
        subject = new Plugin(input.path());
        output = createBuilder(subject);
      });

      afterEach(async function() {
        await input.dispose();
        await output.dispose();
      });

      it('works', async function() {
        input.write({
          'index.js': `console.log('hi')`
        });

        let didFail = false;
        try {
          await output.build();
        } catch(error) {
          didFail = true;
          expect(error.message).to.contain('first build happens to fail');
        }
        expect(didFail).to.eql(true);
        expect(output.read(), 'to be empty').to.deep.equal({});

        await output.build();

        expect(output.read(), 'to no long be empty').to.deep.equal({
          'index.js': `console.log('hi')`
        });
      });

      describe('treeDir and file paths are correct',async function() {
        it('input path is absolute', async function() {
          input.write({
            'index.js': `console.log('hi')`
          });

          try {
            await output.build();
          } catch(error) {
            expect(error.broccoliPayload.originalError.file).to.equal(`index.js`);
            expect(error.broccoliPayload.originalError.treeDir).to.equal(input.path());
            expect(error.message).to.includes(input.path());
            expect(error.message).to.includes(`index.js`);
          }
        });

        it('input path is relative', async function() {
          const TEST_ROOT = `test/fixtures/dependencies`;
          const TEST_FILE = `file1.txt`;
          subject = new Plugin(TEST_ROOT);
          output = createBuilder(subject);
          try {
            await output.build();
          } catch(error) {
            expect(error.broccoliPayload.originalError.file).to.equal(TEST_FILE);
            expect(error.broccoliPayload.originalError.treeDir).to.equal(TEST_ROOT);
            expect(error.message).to.includes(TEST_ROOT);
            expect(error.message).to.includes(TEST_FILE);
          }
        });
      });
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

      beforeEach(async function() {
        process.env.JOBS = '4';
        input = await createTempDir();
        subject = new Plugin(input.path(), { async:true });
        output = createBuilder(subject);
      });

      afterEach(async function() {
        delete process.env.JOBS;
        await input.dispose();
        await output.dispose();
      });

      it('completes all pending work before returning', async function() {
        input.write({
          'index0.js': `console.log('hi')`,
          'index1.js': `console.log('hi')`,
          'index2.js': `console.log('hi')`,
          'index3.js': `console.log('hi')`,
        });

        let didFail = false;
        try {
          await output.build();
        } catch(error) {
          didFail = true;
          expect(error.message).to.contain('file failed for some reason', 'error message text should match');
        }
        expect(didFail).to.eql(true, 'build should fail');
        expect(output.read(), 'should write the files that did not fail').to.deep.equal({
          'index1.js': `console.log('hi')`,
          'index3.js': `console.log('hi')`,
        });
      });
    });

    it('calls processString if work is needed', async function() {
      const subject = new Rot13Filter(input.path(), {
        extensions: ['js'],
        targetExtension: 'OMG'
      });

      sinon.spy(subject, 'processString');
      output = createBuilder(subject);

      await output.build();

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

      await output.build();

      // rebuild, but no changes (build nothing);
      expect(subject.processString.callCount).to.equal(0);

      input.write({
        a : {
          'README.md' : 'OMG'
        }
      });

      await output.build();

      // rebuild 0 files, changed file does not match extensions
      expect(subject.processString.callCount).to.equal(0);
      subject.processString.callCount = 0;
      input.write({
        a : {
          'README.md' : null
        }
      });

      await output.build();

      // rebuild 0 files
      expect(subject.processString.callCount).to.equal(0);
      input.write({
        fooo: {

        }
      });

      await output.build();

      // rebuild, but no changes (build nothing);
      expect(subject.processString.callCount).to.equal(0);

      input.write({
        a: {
          'foo.js': 'OMG'
        }
      });

      await output.build();

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
    });

    it('handles renames', async function() {
      const subject = new Rot13Filter(input.path(), {
        extensions: ['md'],
        targetExtension: ['foo.md']
      });

      sinon.spy(subject, 'processString');
      output = createBuilder(subject);
      await output.build();

      // first time, build everything
      expect(subject.processString.callCount).to.equal(1);
      subject.processString.callCount = 0;
      input.write({
        a: {
          'README-renamed.md': 'Nicest cats in need of homes',
          'README.md': null
        }
      });

      await output.build();

      expect(output.readDir()).to.eql([
        'a/',
        'a/README-renamed.foo.md',
        'a/bar/',
        'a/bar/bar.js',
        'a/foo.js'
      ]);
    });

    it('preserves mtimes if neither content did not actually change', async function() {
      subject = new Rot13Filter(input.path(), {
        extensions: ['md']
      });
      sinon.spy(subject, 'processString');
      output = createBuilder(subject);
      let stat;
      let filePath;
      await output.build();
      // first time, build everything
      expect(subject.processString.callCount).to.equal(1);
      subject.processString.callCount = 0;
      filePath = input.path('a/README.md');

      fs.writeFileSync(filePath, fs.readFileSync(filePath));
      stat = fs.statSync(filePath);

      await output.build();

      let afterRebuildStat = fs.statSync(filePath);

      expect(subject.processString).to.have.been.calledOnce;
      // rebuild changed file
      expect(subject.processString).to.have.been.calledWith('Nicest cats in need of homes', 'a/README.md');

      // although file was 'rebuilt', no observable difference can be observed
      expect(stat.mode).to.equal(afterRebuildStat.mode);
      expect(stat.size).to.equal(afterRebuildStat.size);
      expect(stat.mtime.getTime()).to.equal(afterRebuildStat.mtime.getTime());
    });
  });

  describe(`targetExtension`, function () {
    let input, subject, output;

    beforeEach(async function() {
      input = await createTempDir();
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
    });

    afterEach(async function() {
      await input.dispose();
      await output.dispose();
    });
    it('targetExtension work for no extensions', async function() {
      const subject = new Rot13Filter(input.path(), {
        targetExtension: 'foo',
        extensions: []
      });
      sinon.spy(subject, 'processString');
      output = createBuilder(subject);
      await output.build();
      expect(output.readText('a/README.md')).to.be.equal('Nicest cats in need of homes');
      expect(output.readText('a/foo.js')).to.be.equal('Nicest dogs in need of homes');
      expect(subject.processString.callCount).to.equal(0);
    });

    it('targetExtension work for single extensions', async function() {
      const subject = new Rot13Filter(input.path(), {
        targetExtension: 'foo',
        extensions: ['js']
      });

      sinon.spy(subject, 'processString');
      output = createBuilder(subject);
      await output.build();

      expect(output.readText('a/README.md')).to.equal('Nicest cats in need of homes');
      expect(output.readText('a/foo.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');
      expect(subject.processString.callCount).to.equal(2);

    });

    it('targetExtension work for multiple extensions', async function() {
      const subject = new Rot13Filter(input.path(), {
        targetExtension: 'foo',
        extensions: ['js','md']
      });

      sinon.spy(subject, 'processString');
      output = createBuilder(subject);
      await output.build();

      expect(output.readText('/a/README.foo')).to.equal('Avprfg pngf va arrq bs ubzrf');
      expect(output.readText('/a/foo.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');
      expect(subject.processString.callCount).to.equal(3);
    });

    it('targetExtension work for multiple extensions - async', async function() {
      this.timeout(30*1000); // takes >10s when run with node 0.12
      let subject = new Rot13AsyncFilter(input.path(), {
        targetExtension: 'foo',
        extensions: ['js', 'md'],
        async: true,
      });
      let output = createBuilder(subject);

      await output.build();

      expect(output.readText('a/README.foo')).to.equal('Avprfg pngf va arrq bs ubzrf');
      expect(output.readText('a/foo.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');
    });

  });

  it('handles directories that older versions of walkSync do not sort lexicographically', async function() {
    let input = await createTempDir();
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
        await output.build();
        expect(output.readText('/foo.md')).to.equal('Nicest dogs in need of homes');
        expect(output.readText('foo/bar.foo')).to.equal('Avprfg qbtf va arrq bs ubzrf');

        expect(subject.processString.callCount).to.equal(1);
      } finally {
        await output.dispose();
      }
    } finally {
      await input.dispose();
    }
  });

  describe(`processString, canPorcessFile and Purge cache`, function () {
    let input, output;

    beforeEach(async function() {
      input = await createTempDir();
      input.write({
        a: {
          'README.md': 'Nicest cats in need of homes',
          bar: {
            'bar.js': 'Dogs... who needs dogs?'
          },
          'foo.js': 'Nicest dogs in need of homes'
        }
      });
    });

    afterEach(async function() {
      await input.dispose();
      await output.dispose();
    });

    it('should processString when canProcessFile returns true', async function() {
      const subject = new ReplaceFilter(input.path(), {
        glob: '**/*.md',
        search: 'dogs',
        replace: 'cats',
        targetExtension: 'foo'
      });
      sinon.spy(subject, 'processString');
      output = createBuilder(subject);
      await output.build();
      expect(output.readText('/a/README.md')).to.equal('Nicest cats in need of homes');
      expect(output.readText('/a/foo.js')).to.equal('Nicest dogs in need of homes');
      expect(subject.processString.callCount).to.equal(1);
    });

    it('should processString and postProcess', async function() {
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
        await output.build();
        expect(output.readText('/a/README.md')).to.equal('Nicest cats in need of homes' + 0x00 + 'POST_PROCESSED!!');
        expect(output.readText('/a/foo.js')).to.equal('Nicest cats in need of homes' + 0x00 + 'POST_PROCESSED!!');
        expect(subject.processString.callCount).to.equal(3);
        expect(subject.postProcess.callCount).to.equal(3);
    });

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

    it('purges cache', async function() {
      const subject = new ReplaceFilter(input.path(), {
        glob: '**/*.md',
        search: 'dogs',
        replace: 'cats'
      });
      const output = createBuilder(subject);
      await output.build();
      input.write({
        a: {
          'README.md': null
        }
      });
      expect(input.readDir()).to.not.includes('a/README.md');
      expect(output.readDir()).to.includes('a/README.md');
      await output.build();
      expect(output.readDir()).to.not.includes('a/README.md');
      input.write({
        a: {
          'README.md': 'Nicest cats in need of homes'
        }
      });
      expect(input.readDir()).to.includes('a/README.md');
      await output.build();
      expect(output.readDir()).to.includes('a/foo.js');
    });
  });

  describe('stale entries', function () {
    let input, subject, output;

    beforeEach(async function() {
      input = await createTempDir();
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
    });

    afterEach(async function() {
      await input.dispose();
      await output.dispose();
    });
    it('replaces stale entries', async function() {
      const subject = new ReplaceFilter(input.path(), {
        glob: '**/*.md',
        search: 'dogs',
        replace: 'cats'
      });

      let fileForChange = path.join(input.path(), 'a', 'README.md');
      const output = createBuilder(subject);
      await output.build();
      input.write({
        a: {
          'README.md': 'such changes'
        }
      });
      await output.build();
      expect(file(fileForChange)).to.exist;

      write(fileForChange, 'such changes');

      expect(file(fileForChange)).to.exist;

      await output.build();

      expect(file(fileForChange)).to.exist;

      write(fileForChange, 'such changes');

      expect(file(fileForChange)).to.exist;
    });

    it('replaces stale entries - async', async function() {
      let subject = new ReplaceAsyncFilter(input.path(), {
        glob: '**/*.md',
        search: 'cats',
        replace: 'dogs',
        async: true,
      });
      let fileForChange = path.join(input.path(), 'a', 'README.md');
      let output = createBuilder(subject);

      await output.build();

      expect(output.readText('/a/README.md')).to.equal('Nicest dogs in need of homes');

      expect(file(fileForChange)).to.exist;

      input.write({
        a: {
          'README.md': 'such changes'
        }
      });

      expect(file(fileForChange)).to.exist;

      await output.build();

      expect(output.readText('/a/README.md')).to.equal('such changes');
    });


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

  it('reports heimdall timing correctly for async work', async function() {
    let input = await createTempDir();
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

    await output.build();

    var applyPatchesNode = heimdall.toJSON().nodes.filter(elem => elem.id.name === 'applyPatches')[0];
    var selfTime = applyPatchesNode.stats.time.self / (1000 * 1000); // convert to ms
    expect(selfTime).to.be.above(0, 'reported time should include the 50ms timeout in Rot13AsyncFilter');
  });

  describe('persistent cache (delete process.env.CI)', function() {
    const hasCIValue = ('CI' in process.env);
    const CI_VALUE = process.env.CI;
    let input;

    class F extends Filter{
      constructor (inputTree, options) {
        super(inputTree, options);
      }

      processString() {
        return '';
      }
    }

    F.prototype.baseDir = function() {
      return path.join(__dirname, '../');
    };

    beforeEach(async function() {
      delete process.env.CI;
      this.originalCacheRoot = process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT;
      input = await createTempDir();
      input.write({
        a: {
          'README.md': 'Nicest cats in need of homes',
          bar: {
            'bar.js': 'Dogs... who needs dogs?'
          },
          'foo.js': 'Nicest dogs in need of homes'
        }
      });
    });

    afterEach(async function() {
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
      await input.dispose();
    });

    it('does not initialize the cache until `build`', function() {
      this.timeout(15*1000); // takes >5s when run with node 0.12
      let f = new F(input.path(), {
        persist: true
      });

      // TODO: we should just deal in observable differences, not reaching into private state
      expect(f.processor.processor._cache).to.be.undefined;
    });

    it('initializes the cache when `build` is called', async function() {
      this.timeout(15*1000); // takes >5s when run with node 0.12
      let subject = new F(input.path(), {
        persist: true
      });

      const output = createBuilder(subject);
      await output.build();

      // TODO: we should just deal in observable differences, not reaching into private state
      expect(subject.processor.processor._cache).to.be.ok;
    });

    it('initializes cache using ENV variable if present', async function() {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpdir(),
                                                                    'foo-bar-baz-testing-123');

      let subject = new F(input.path(), {
        persist: true
      });

      const output = createBuilder(subject);
      await output.build();

      // TODO: we should just deal in observable differences, not reaching into private state
      expect(subject.processor.processor._cache.tmpdir).
        to.be.equal(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);
    });

    it('throws an UnimplementedException if the abstract `baseDir` implementation is used', async function() {

      class F extends Filter{
        constructor (inputTree, options) {
          super(inputTree, options);
        }
      }

      const subject = new F(input.path(), { persist: true });
      const output = createBuilder(subject);

      try {
        await output.build();
      } catch (e) {
        expect(e.message).to.include('Filter must implement prototype.baseDir');
      }
    });

    it('`cacheKeyProcessString` return correct first level file cache', function() {
      let f = new F(input.path(), { persist: true });

      expect(f.cacheKeyProcessString('foo-bar-baz', 'relative-path')).
        to.eql('272ebac734fa8949ba2aa803f332ec5b');
    });

    it('properly reads the file tree', async function() {
      const input = await createTempDir();
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
          await output.build();
          expect(output.readDir()).to.deep.eql([
            'a/',
            'a/README.md',
            'a/bar/',
            'a/bar/bar.js',
            'a/foo.js'
          ]);
        }finally {
          await output.dispose();
        }
      } finally {
        await input.dispose();
      }
    });

    it('calls postProcess for persistent cache hits (work is not needed)', async function() {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpdir(),
        'process-cache-string-tests');
      rimraf(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);
      const input = await createTempDir();
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
          await output.build();
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
          await output.build();
          expect(subject.processString.callCount).to.equal(0);
          expect(subject.postProcess.callCount).to.equal(3);

        }finally {
          await output.dispose();
        }
      } finally {
        await input.dispose();
      }
    });

    it('postProcess return value is not used', async function() {
      process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT = path.join(os.tmpdir(),
        'process-cache-string-tests');
      rimraf(process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT);
      const input = await createTempDir();
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
          await output.build();
          expect(output.readText('/a/foo.js')).to.equal('Nicest dogs in need of homes' + 0x00 + 'POST_PROCESSED!!');
        }finally {
          await output.dispose();
        }
      } finally {
        await input.dispose();
      }
    });
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

    beforeEach(async function() {
      process.env.CI = true;
      this.originalCacheRoot = process.env.BROCCOLI_PERSISTENT_FILTER_CACHE_ROOT;
      input = await createTempDir();
      input.write({
        a: {
          'README.md': 'Nicest cats in need of homes',
          bar: {
            'bar.js': 'Dogs... who needs dogs?'
          },
          'foo.js': 'Nicest dogs in need of homes'
        }
      });
    });

    afterEach(async function() {
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
      await input.dispose();
    });

    it('initializes cache', function() {
      let f = new F(input.path(), {
        persist: true
      });

      // TODO: we should just deal in observable differences, not reaching into private state
      expect(f.processor.processor._cache).to.eql(undefined);
    });

    it('calls postProcess for persistent cache hits (work is not needed)', async function() {
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
      await output.build();
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
      await output.build();
      expect(subject.processString.callCount).to.equal(3);
      await output.dispose();
    });
  });

  describe('processFile', function() {
    let input, subject, output;

    beforeEach(async function() {
      sinon.spy(fs, 'mkdirSync');
      sinon.spy(fs, 'writeFileSync');

      input = await createTempDir();
      subject = new ReplaceFilter(input.path(), {
        search: 'dogs',
        replace: 'cats'
      });

      sinon.spy(subject, 'processString');
      sinon.spy(subject, 'postProcess');

      output = createBuilder(subject);
    });

    afterEach(async function() {
      fs.mkdirSync.restore();
      fs.writeFileSync.restore();

      await input.dispose();
      await output.dispose();
    });

    it('should work if `processString` returns a Promise', async function() {
      input.write({
        'foo.js': 'a promise is a promise'
      });

      await output.build();

      expect(output.read()['foo.js']).to.equal('a promise is a promise');
    });

    it('does not effect the current cwd', async function() {
      input.write({
        'a': {
          'foo.js': 'Nicest dogs in need of homes'
        }
      });

      await output.build();

      let cwd = process.cwd();
      let a = path.join(cwd, 'a');

      expect(fs.mkdirSync.calledWith(a, 493)).to.eql(false);
      expect(fs.mkdirSync.calledWith(path.join(a, 'bar'), 493)).to.eql(false);

      expect(fs.writeFileSync.calledWith(path.join(cwd, 'a', 'foo.js'),
        'Nicest dogs in need of homes')).to.eql(false);

      await output.build();

      expect(fs.writeFileSync.calledWith(path.join(cwd, 'a', 'foo.js'),
        'Nicest dogs in need of homes')).to.eql(false);
    });

    it('does not accidentally write to symlinks it created', async function() {
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

      await output.build();

      expect(output.read()).to.eql({
        'foo.js': ORIGINAL_FOO_JS
      });

      input.write({
        'foo.coffee': '\'coffee source\''
      });

      await output.build();

      expect(output.read()).to.eql({
        'foo.js': '\'coffee source\''
      });
      expect(input.read()['foo.js']).to.eql(ORIGINAL_FOO_JS);
    });
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

    afterEach(async function() {
      await input.dispose();
      await output.dispose();
    });

    it('calls processString if work is needed', async function() {
      input = await createTempDir();
      input.write({
        'dep-tracking': {
          'has-inlines.js': `// << ./local.js\n// << ${input.path('external-deps/external.js')}\n`,
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

      let results = await output.build();
      // first time, build everything
      expect(subject.processString.callCount).to.equal(3);

      expect(output.readText('has-inlines.js')).to.equal(
        `console.log('local');\n`+
        `console.log('external');\n`
      );

      subject.processString.callCount = 0;

      results = await output.build();

      // rebuild, but no changes (build nothing);
      expect(subject.processString.callCount).to.equal(0);

      input.write({
        'dep-tracking': {
          'local.js': `console.log('local changed');\n`
        }
      });

      results = await output.build();
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
          'has-inlines.js': `// << ${input.path('external-deps/external.js')}\n`
        }
      });


      results = await output.build();
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

      results = await output.build();
      // rebuild 1 files, make sure changes outside the tree invalidate files.
      expect(subject.processString.callCount).to.equal(1);
      expect(output.readText('has-inlines.js')).to.equal(
        `console.log('external changed');\n`
      );
    });
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

      it('calls processString if work is needed', async function() {
        input = await createTempDir();
        input.write({
          'dep-tracking-0': {
            'unrelated-file.js': `console.log('pay me no mind.')\n`
          },
          'dep-tracking-1': {
            'has-inlines.js': `// << ./local.js\n// << ${input.path('external-deps/external.js')}\n`,
            'local.js': `console.log('local');\n`,
            'unrelated-file.js': `console.log('pay me no mind.')\n`
          },
          'dep-tracking-2': {
            'has-inlines.js': `// << ./local.js\n// << ${input.path('external-deps/external.js')}\n`,
            'local.js': `console.log('local changed');\n`,
            'unrelated-file.js': `console.log('pay me no mind.')\n`
          },
          'dep-tracking-3': {
            'has-inlines.js': `// << ${input.path('external-deps/external.js')}\n`,
            'local.js': null,
            'unrelated-file.js': `console.log('pay me no mind.')\n`
          },
          'external-deps': {
            'external.js': `console.log('external');\n`
          }
        });

        // First we make sure the dependency tracking doesn't cause errors with
        // no dependencies.
        subject = new Inliner(path.join(input.path(), 'dep-tracking-0'), {
          persist: true
        });
        output = createBuilder(subject);
        await output.build();

        // Next we make sure the dependency tracking doesn't cause errors with
        // no dependencies in the previous build.
        subject = new Inliner(path.join(input.path(), 'dep-tracking-0'), {
          persist: true
        });
        output = createBuilder(subject);
        await output.build();

        rimraf(subject.processor.processor._cache.root);
        rimraf(subject.processor.processor._syncCache.root);

        // Now we test if there's dependencies.
        subject = new Inliner(path.join(input.path(), 'dep-tracking-1'), {
          persist: true
        });
        sinon.spy(subject, 'processString');
        output = createBuilder(subject);

        let results = await output.build();

        // first time, build everything
        expect(output.readText('has-inlines.js')).to.equal(
          `console.log('local');\nconsole.log('external');\n`
        );
        expect(subject.processString.callCount).to.equal(3);


        subject.processString.callCount = 0;
        await output.dispose();

        subject = new Inliner(path.join(input.path(), 'dep-tracking-1'), {
          persist: true
        });
        sinon.spy(subject, 'processString');
        output = createBuilder(subject);

        results = await output.build();

        // rebuild, but no changes (build nothing);
        expect(subject.processString.callCount).to.equal(0);

        await output.dispose();

        subject = new Inliner(path.join(input.path(), 'dep-tracking-2'), {
          persist: true
        });
        sinon.spy(subject, 'processString');
        output = createBuilder(subject);

        results = await output.build();

        // rebuild 1 file due to invalidations, one due to changes.
        expect(subject.processString.callCount).to.equal(2);

        expect(output.readText('has-inlines.js')).to.equal(
          `console.log('local changed');\nconsole.log('external');\n`
        );

        subject.processString.callCount = 0;
        await output.dispose();

        subject = new Inliner(path.join(input.path(), 'dep-tracking-3'), {
          persist: true
        });
        sinon.spy(subject, 'processString');
        output = createBuilder(subject);

        results = await output.build();
        // rebuild 1 files, make sure no error occurs from file deletion
        expect(subject.processString.callCount).to.equal(1);
        expect(output.readText('has-inlines.js')).to.equal(
          `console.log('external');\n`
        );
        subject.processString.callCount = 0;
        await output.dispose();

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

        results = await output.build();
        // rebuild 1 files, make sure changes outside the tree invalidate files.
        expect(subject.processString.callCount).to.equal(1);
        expect(output.readText('has-inlines.js')).to.equal(
          `console.log('external changed');\n`
        );
      });

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

  beforeEach(async function() {
    input = await createTempDir();
    input.write({
      'index0.js': `console.log('hi')`,
      'index1.js': `console.log('hi')`,
      'index2.js': `console.log('hi')`,
      'index3.js': `console.log('hi')`,
    });
  });

  afterEach(async function() {
    delete process.env.JOBS;
    expect(output.read(), 'all files should be written').to.deep.equal({
      'index0.js': `console.log('hi')`,
      'index1.js': `console.log('hi')`,
      'index2.js': `console.log('hi')`,
      'index3.js': `console.log('hi')`,
    });

    await input.dispose();
    await output.dispose();
  });

  it('throttles operations to 1 concurrent job', async function() {
    process.env.JOBS = '1';
    subject = new Plugin(input.path(), { async:true });
    output = createBuilder(subject);
    expect(subject.concurrency).to.equal(1);

    var startTime = process.hrtime();

    await output.build();

    expect(millisecondsSince(startTime)).to.be.above(400, '4 groups of 1 file each, taking 100ms each, should take at least 400ms');
  });

  it('throttles operations to 2 concurrent jobs', async function() {
    process.env.JOBS = '2';
    subject = new Plugin(input.path(), { async:true });
    output = createBuilder(subject);
    expect(subject.concurrency).to.equal(2);

    var startTime = process.hrtime();

    await output.build();

    expect(millisecondsSince(startTime)).to.be.above(200, '2 groups of 2 files each, taking 100ms each, should take at least 200ms');
  });

  it('throttles operations to 4 concurrent jobs', async function() {
    process.env.JOBS = '4';
    subject = new Plugin(input.path(), { async:true });
    output = createBuilder(subject);
    expect(subject.concurrency).to.equal(4);

    var startTime = process.hrtime();

    await output.build();

    expect(millisecondsSince(startTime)).to.be.above(100, '1 group of all 4 files, taking 100ms each, should take at least 100ms');
    expect(millisecondsSince(startTime)).to.be.below(200, 'all 4 jobs running concurrently in 1 group should finish in about 100ms');
  });

});
