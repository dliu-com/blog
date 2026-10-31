'use strict';

// Reader reactions: one per visitor per post (Facebook style). Readers don't sign in; a visitor is the
// dl_vid cookie that the traffic monitor's CloudFront function gives every browser on .dliu.com, so a
// reaction can be matched with that visitor's visits.
const crypto = require('crypto');

const REACTIONS = ['like', 'love', 'haha', 'sad'];
const VISITOR_COOKIE = 'dl_vid';
// Same format and lifetime as the traffic monitor's visitor-id function.
const VISITOR_ID = /^[a-z0-9]{8,40}$/;
const VISITOR_SECONDS = 31536000;
// Changes allowed per IP address per hour, across all posts. Stops one machine from clearing its
// cookie in a loop to inflate counts; it can't stop someone with many addresses.
const RATE_LIMIT = 60;
const RATE_WINDOW_SECONDS = 3600;

class ReactionInputError extends Error {}

function parseReaction(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('reaction' in body)) {
    throw new ReactionInputError('Send {"reaction": "like" | "love" | "haha" | "sad" | null}');
  }
  const { reaction } = body;
  if (reaction !== null && !REACTIONS.includes(reaction)) throw new ReactionInputError(`reaction must be one of ${REACTIONS.join(', ')} or null`);
  return reaction;
}

// Time in base 36 and 16 random characters, like the traffic monitor's IDs (but from a secure source).
function newVisitorId(now = Date.now()) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  return now.toString(36) + Array.from({ length: 16 }, () => chars[crypto.randomInt(chars.length)]).join('');
}

// Shared across the root domain's subdomains, like the traffic monitor's cookie.
function visitorCookie(id, siteUrl, rootDomain) {
  const url = new URL(siteUrl);
  const host = url.hostname.toLowerCase();
  const root = String(rootDomain || '').toLowerCase();
  const domain = root && (host === root || host.endsWith(`.${root}`)) ? `Domain=.${root}; ` : '';
  return `${VISITOR_COOKIE}=${id}; ${domain}Path=/; Max-Age=${VISITOR_SECONDS}; ${url.protocol === 'https:' ? 'Secure; ' : ''}HttpOnly; SameSite=Lax`;
}

// IP addresses are only kept hashed, in rate-limit windows that expire.
const viewerKey = (ip) => crypto.createHash('sha256').update(`viewer:${ip || 'unknown'}`).digest('hex');

// Always all four, never negative.
function toCounts(item) {
  return Object.fromEntries(REACTIONS.map((name) => [name, Math.max(0, Number((item && item[name]) || 0))]));
}

module.exports = {
  RATE_LIMIT, RATE_WINDOW_SECONDS, REACTIONS, ReactionInputError, VISITOR_COOKIE, VISITOR_ID,
  newVisitorId, parseReaction, toCounts, viewerKey, visitorCookie,
};
