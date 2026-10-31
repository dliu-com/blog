'use strict';

// In-memory stand-in for lambda/api/store.js, used by the tests and the local dev server.
const { Conflict, Exists, SUMMARY_FIELDS } = require('../lambda/api/store');

function createMemoryStore() {
  const posts = new Map();
  const tokens = new Map();
  // post ID -> { counts: {}, visitors: Map(visitor -> reaction) }; viewer windows -> request count.
  const reactions = new Map();
  const windows = new Map();
  const clone = (value) => (value == null ? value : structuredClone(value));
  const pick = (item) => Object.fromEntries(SUMMARY_FIELDS.filter((name) => name in item).map((name) => [name, clone(item[name])]));

  return {
    posts,
    tokens,
    reactions,
    windows,
    async listTokens() {
      return [...tokens.values()].map(clone);
    },
    async getToken(id) {
      return clone(tokens.get(id) || null);
    },
    async putToken(item) {
      if (tokens.has(item.id)) throw new Exists(`Token ${item.id} already exists`);
      tokens.set(item.id, clone(item));
      return item;
    },
    async touchToken(id, lastUsedAt) {
      if (tokens.has(id)) tokens.get(id).lastUsedAt = lastUsedAt;
    },
    async deleteToken(id) {
      return tokens.delete(id);
    },
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
    async getReactions(postId, visitor) {
      const entry = reactions.get(postId);
      return { counts: clone(entry ? entry.counts : {}), mine: (entry && visitor && entry.visitors.get(visitor)) || null };
    },
    async setReaction(postId, visitor, from, to) {
      if (!reactions.has(postId)) reactions.set(postId, { counts: {}, visitors: new Map() });
      const entry = reactions.get(postId);
      if ((entry.visitors.get(visitor) || null) !== from) throw new Conflict('Reaction changed meanwhile');
      if (to) {
        entry.visitors.set(visitor, to);
        entry.counts[to] = (entry.counts[to] || 0) + 1;
      } else {
        entry.visitors.delete(visitor);
      }
      if (from) entry.counts[from] = (entry.counts[from] || 0) - 1;
    },
    async countRequest(viewer, windowStart, limit) {
      const key = `${viewer}|${windowStart}`;
      const n = windows.get(key) || 0;
      if (n >= limit) return false;
      windows.set(key, n + 1);
      return true;
    },
    async deleteReactions(postId) {
      reactions.delete(postId);
    },
  };
}

module.exports = { createMemoryStore };
