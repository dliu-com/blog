'use strict';

// In-memory stand-in for lambda/api/store.js, used by the tests and the local dev server.
const { Exists, SUMMARY_FIELDS } = require('../lambda/api/store');

function createMemoryStore() {
  const posts = new Map();
  const clone = (value) => (value == null ? value : structuredClone(value));
  const pick = (item) => Object.fromEntries(SUMMARY_FIELDS.filter((name) => name in item).map((name) => [name, clone(item[name])]));

  return {
    posts,
    async listPosts() {
      return [...posts.values()].map(pick);
    },
    async getPost(id) {
      return clone(posts.get(id) || null);
    },
    async putPost(item, { create = false } = {}) {
      if (create && posts.has(item.id)) throw new Exists(`Post ${item.id} already exists`);
      posts.set(item.id, clone(item));
      return item;
    },
    async deletePost(id) {
      posts.delete(id);
    },
  };
}

module.exports = { createMemoryStore };
