'use strict';

var md5Hex = require('md5-hex');
var AsyncDiskCache = require('async-disk-cache');

module.exports = {

  _peristentCache: {},

  init: function(ctx) {
    if (!ctx.constructor._persistentCacheKey) {
      ctx.constructor._persistentCacheKey = this.cacheKey(ctx);
    }

    this._peristentCache = new AsyncDiskCache(ctx.constructor._persistentCacheKey, {
      compression: 'deflate'
    });
  },

  cacheKey: function(ctx) {
    return ctx.cacheKey();
  },

  processString: function(ctx, contents, relativePath) {
    var key = ctx.cacheKeyProcessString(contents, relativePath);
    return this._peristentCache.get(key).then(function(entry) {
      var result;

      if (entry.isCached) {
        result = {
          string: entry.value,
          key: key
        };
      } else {
        result = {
          string: ctx.processString(contents, relativePath),
          key: key
        };
      }

      return result;
    });
  },

  done: function(ctx, result) {
    return this._peristentCache.set(result.key, result.string);
  }
};
