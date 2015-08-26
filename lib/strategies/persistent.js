'use strict';

var AsyncDiskCache = require('async-disk-cache');

module.exports = {

  _persistentCache: {},

  init: function(ctx) {
    if (!ctx.constructor._persistentCacheKey) {
      ctx.constructor._persistentCacheKey = this.cacheKey(ctx);
    }

    this._persistentCache = new AsyncDiskCache(ctx.constructor._persistentCacheKey, {
      compression: 'deflate'
    });
  },

  cacheKey: function(ctx) {
    return ctx.cacheKey();
  },

  processString: function(ctx, contents, relativePath) {
    var key = ctx.cacheKeyProcessString(contents, relativePath);
    return this._persistentCache.get(key).then(function(entry) {
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
    return this._persistentCache.set(result.key, result.string);
  }
};
