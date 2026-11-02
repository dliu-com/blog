'use strict';

// In-memory stand-in for lambda/api/store.js, used by the tests and the local dev server.
const { Conflict, Exists, SUMMARY_FIELDS } = require('../lambda/api/store');

function createMemoryStore() {
  const posts = new Map();
  // post ID -> { counts: {}, visitors: Map(visitor -> reaction), times: Map(visitor -> updatedAt) }; viewer windows -> request count.
  const reactions = new Map();
  const windows = new Map();
  const clone = (value) => (value == null ? value : structuredClone(value));
  const pick = (item) => Object.fromEntries(SUMMARY_FIELDS.filter((name) => name in item).map((name) => [name, clone(item[name])]));

  return {
    posts,
    reactions,
    windows,
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
    async listReactionVisitors(postId) {
      const entry = reactions.get(postId);
      if (!entry) return [];
      return [...entry.visitors].map(([visitor, reaction]) => ({ visitor, reaction, updatedAt: entry.times.get(visitor) || null }));
    },
    async setReaction(postId, visitor, from, to, at) {
      if (!reactions.has(postId)) reactions.set(postId, { counts: {}, visitors: new Map(), times: new Map() });
      const entry = reactions.get(postId);
      if ((entry.visitors.get(visitor) || null) !== from) throw new Conflict('Reaction changed meanwhile');
      if (to) {
        entry.visitors.set(visitor, to);
        entry.times.set(visitor, at || null);
        entry.counts[to] = (entry.counts[to] || 0) + 1;
      } else {
        entry.visitors.delete(visitor);
        entry.times.delete(visitor);
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
