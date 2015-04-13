var Filter = require('broccoli-filter');
var Cache = require('async-disk-cache');
var crypto = require('crypto');
var fs = require('fs');
var hashForDep = require('hash-for-dep');

module.exports = PersistentFilter;

/*
 * @public
 *
 * `broccoli-persistent-filter` is broccoli-filter but it is able to persit
 * state across restarts. This exists to mitigate the upfront cost of some more
 * expensive transforms on warm boot.
 *
 * Why isn't this the default behaviour?
 *
 * Deriving the correct cache key for a
 * given filter can be tricky. In addition, this should be seen as a last
 * resort, if a given filter is too slow often times it should be improved
 * rather then opting for caching.
 *
 * What does this do?
 *
 * * This does not aim to improve incremental build performance, if it does, it
 *   should indicate something is wrong with the filter ir input filter in
 *   question.
 *
 * * This does not improve cold boot times.
 *
 * How does it work?
 *
 * It does so but establishing a 2 layer file cache.
 * The first layer, is the entire bucket. The second, `cacheKeyProcessString`
 * is a per file cache key.
 *
 * Together, these two layers should provide the right balance of speed and
 * sensibility.
 *
 * The bucket level cacheKey must be stable but also never become stale. If the
 * key is not stable, state between restarts will be lost and performance will
 * suffer.  On the flip-side, if the cacheKey becomes stale changes may not be
 * correctly reflected.
 *
 * It is configured by subclassing and refining `cacheKey` method. A good key
 * here, is likely the name of the plugin, its version and the actual versions
 * of its dependencies
 *
 * ```js
 * Subclass.prototype.cacheKey = function() {
 *  return md5(Filter.prototype.call(this) + inputOptionsChecksum + dependencyVersionChecksum);
 * }
 * ```
 *
 * The second key, represents the contents of the file. Typically the
 * base-class's functionality is sufficient, as it merely generates a checksum
 * of the file contents. If for some reason this is not sufficient, it can be
 * re-configured via subclassing.
 *
 * ```js
 * Subbclass.prototype.cacheKeyProcessString = function(string, relativePath) {
 *   return superAwsomeDigest(string);
 * }
 * ```
 *
 * @class PersistentFilter
 * @param {Tree} inputTree
 * @param {Object} options
 *
 * */
function PersistentFilter(inputTree, options) {
  Filter.call(this, inputTree, options);
  this.cache = new Cache(this.cacheKey());
}

PersistentFilter.prototype = Object.create(Filter.prototype);

/*
 * @private
 * 
 *
 * @method cachKey
 * @return {String} this filters top-level cache key
 */
PersistentFilter.prototype.cacheKey = function() {
  return hashForDep(this.baseDir());
};

/* @public
 *
 * @method baseDir
 * @returns {String} absolute path to the root of the filter...
 */
PersistentFilter.prototype.baseDir = function() {
  throw Error('Filter must implement prototype.baseDir');
};

/*
 * @public
 *
 * @method cacheKeyProcessString
 * @return {String} this filters top-level cache key
 */
PersistentFilter.prototype.cacheKeyProcessString = function(string, relativePath) {
  return crypto.createHash('md5').update(string).digest('hex');
};


/*
 * @private
 *
 * @method processFile
 * @param {String} srcDir
 * @param {String} destDir
 * @param {String} relativePath
 * @return {Promise}
 */
PersistentFilter.prototype.processFile = function(srcDir, destDir, relativePath) {
  var filter = this;
  var inputEncoding = (this.inputEncoding === undefined) ? 'utf8' : this.inputEncoding;
  var outputEncoding = (this.outputEncoding === undefined) ? 'utf8' : this.outputEncoding;
  var string = fs.readFileSync(srcDir + '/' + relativePath, { encoding: inputEncoding });
  var cache = this.cache;
  var key = this.cacheKeyProcessString(string, relativePath);

  return cache.get(key).then(function(entry) {
     return entry.isCached ? entry.value : filter.processString(string, relativePath);
  }).then(function(outputString) {
    var outputPath = filter.getDestFilePath(relativePath);
    fs.writeFileSync(destDir + '/' + outputPath, outputString, { encoding: outputEncoding });

    return cache.set(key, outputString);
  });
};
