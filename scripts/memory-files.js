'use strict';

// In-memory stand-in for lambda/api/s3.js. The dev server serves these objects at /content/, /media/ and /dev-files/.
const { CONTENT_CACHE, mediaHeaders, uploadKey } = require('../lambda/api/s3');

function createMemoryFiles({ base = '' } = {}) {
  const objects = new Map();

  return {
    objects,
    origin: base,
    put(key, body, type) {
      objects.set(key, { body: Buffer.from(body), type: type || 'application/octet-stream', headers: {} });
    },
    uploadUrl(postId, fileId, { type }) {
      return { url: `${base}/dev-files/${uploadKey(postId, fileId)}`, headers: { 'content-type': type } };
    },
    async uploaded(postId, fileId) {
      const object = objects.get(uploadKey(postId, fileId));
      return object ? { size: object.body.length, type: object.type } : null;
    },
    async keep(postId, fileId, file, key) {
      const object = objects.get(uploadKey(postId, fileId));
      const headers = mediaHeaders(file);
      objects.set(key, { body: object.body, type: headers.ContentType, headers: { 'content-disposition': headers.ContentDisposition, 'cache-control': headers.CacheControl } });
      objects.delete(uploadKey(postId, fileId));
    },
    async remove(key) {
      objects.delete(key);
    },
    async removePost(postId) {
      for (const key of [...objects.keys()]) if (key.startsWith(`media/${postId}/`)) objects.delete(key);
    },
    async putContent(path, data) {
      objects.set(`content/${path}`, { body: Buffer.from(JSON.stringify(data)), type: 'application/json; charset=utf-8', headers: { 'cache-control': CONTENT_CACHE } });
    },
    async deleteContent(path) {
      objects.delete(`content/${path}`);
    },
    json(path) {
      const object = objects.get(`content/${path}`);
      return object ? JSON.parse(object.body.toString('utf8')) : null;
    },
  };
}

module.exports = { createMemoryFiles };
