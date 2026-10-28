'use strict';

// API tokens let another program (for example an AI agent) manage posts without a browser.
// A token is blog_<id>_<secret>; only a SHA-256 hash of the secret is stored.
const crypto = require('crypto');

const TOKEN = /^blog_([a-f0-9]{12})_([a-f0-9]{64})$/;
const TOKEN_ID = /^[a-f0-9]{12}$/;
const MAX_TOKENS = 20;
const MAX_NAME = 60;
const EXPIRY_DAYS = [7, 30, 90, 365, 0];
const DEFAULT_EXPIRY_DAYS = 90;
const TOUCH_AFTER_MS = 5 * 60 * 1000;

class TokenInputError extends Error {}

const hashSecret = (secret) => crypto.createHash('sha256').update(secret).digest('hex');

function parseTokenRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TokenInputError('Expected a JSON object');
  const name = typeof body.name === 'string' ? body.name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new TokenInputError('Give the token a name, for example the agent that will use it');
  if (name.length > MAX_NAME) throw new TokenInputError(`Name must be at most ${MAX_NAME} characters`);
  const days = body.expiresInDays === undefined ? DEFAULT_EXPIRY_DAYS : body.expiresInDays;
  if (!EXPIRY_DAYS.includes(days)) throw new TokenInputError(`expiresInDays must be one of: ${EXPIRY_DAYS.join(', ')} (0 = never)`);
  return { name, days };
}

function newToken({ name, days }, user, now) {
  const id = crypto.randomBytes(6).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const item = {
    id,
    name,
    secretHash: hashSecret(secret),
    createdAt: new Date(now).toISOString(),
    createdBy: user.user,
    createdByName: user.name || user.user,
    expiresAt: days ? new Date(now + days * 86400000).toISOString() : '',
  };
  // DynamoDB removes expired items by itself (ttl is in seconds); expiry is also checked on every request.
  if (days) item.ttl = Math.floor(now / 1000) + days * 86400 + 86400;
  return { item, token: `blog_${id}_${secret}` };
}

const isExpired = (item, now) => Boolean(item.expiresAt) && Date.parse(item.expiresAt) <= now;

const toApiToken = (item) => ({
  id: item.id,
  name: item.name,
  createdAt: item.createdAt,
  createdByName: item.createdByName || '',
  expiresAt: item.expiresAt || '',
  lastUsedAt: item.lastUsedAt || '',
});

// Returns the token item if `token` is genuine, unexpired and not revoked; otherwise null.
async function verifyToken(store, token, now) {
  const match = TOKEN.exec(String(token || '').trim());
  if (!match) return null;
  const item = await store.getToken(match[1]);
  if (!item || isExpired(item, now)) return null;
  const expected = Buffer.from(item.secretHash || '', 'hex');
  const actual = Buffer.from(hashSecret(match[2]), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  if (!item.lastUsedAt || now - Date.parse(item.lastUsedAt) > TOUCH_AFTER_MS) {
    await store.touchToken(item.id, new Date(now).toISOString()).catch((error) => {
      console.error(JSON.stringify({ message: 'Could not record token use', tokenId: item.id, error: error.message }));
    });
  }
  return item;
}

module.exports = {
  DEFAULT_EXPIRY_DAYS, EXPIRY_DAYS, MAX_TOKENS, TOKEN, TOKEN_ID, TokenInputError,
  hashSecret, isExpired, newToken, parseTokenRequest, toApiToken, verifyToken,
};
