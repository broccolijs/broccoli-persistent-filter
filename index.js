var Filter = require('broccoli-filter');
var Cache = require('async-disk-cache');
var crypto = require('crypto');
var fs = require('fs');

module.exports = PersistentFilter;

function PersistentFilter(inputTree, options) {
  Filter.call(this, inputTree, options);
  this.cache = new Cache(this.cacheKey());
}

PersistentFilter.prototype = Object.create(Filter.prototype);

PersistentFilter.prototype.cacheKey = function() {
  // this will be have to be derived from the checksum of the dependencies
  return 'persistent-filter-3';
};

PersistentFilter.prototype.cacheKeyProcessString = function(string, relativePath) {
  return crypto.createHash('md5').update(string).digest('hex');
};

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
