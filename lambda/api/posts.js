'use strict';

// Post validation and the public (published) shapes written to the content bucket.
const crypto = require('crypto');

const POST_ID = /^[A-Za-z0-9_-]{12}$/;
const FILE_ID = /^[A-Za-z0-9_-]{16}$/;
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const SLUG = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
const STATUSES = ['draft', 'published'];

const MAX_TITLE = 200;
const MAX_SLUG = 80;
// DynamoDB items are limited to 400 KB; this leaves room for the attachment list.
const MAX_BODY_BYTES = 200 * 1024;
const MAX_FILES = 100;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const EXCERPT_LENGTH = 280;

class BadRequest extends Error {}

const newPostId = () => crypto.randomBytes(9).toString('base64url');
const newFileId = () => crypto.randomBytes(12).toString('base64url');

function text(value, field, max, { trim = true } = {}) {
  if (value == null) value = '';
  if (typeof value !== 'string') throw new BadRequest(`${field} must be text`);
  let clean = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (trim) clean = clean.trim();
  if (clean.length > max) throw new BadRequest(`${field} must be at most ${max} characters`);
  return clean;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
}

// Only the fields that were sent, so a client can save just the title or just the status.
function parsePostUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequest('Expected a JSON object');
  const update = {};
  if ('title' in body) update.title = text(body.title, 'Title', MAX_TITLE).replace(/\s+/g, ' ');
  if ('body' in body) {
    update.body = text(body.body, 'Post', Infinity, { trim: false }).replace(/\s+$/, '');
    if (Buffer.byteLength(update.body, 'utf8') > MAX_BODY_BYTES) throw new BadRequest(`Posts can be at most ${MAX_BODY_BYTES / 1024} KB of text`);
  }
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) throw new BadRequest(`Status must be one of: ${STATUSES.join(', ')}`);
    update.status = body.status;
  }
  if ('slug' in body && body.slug != null && body.slug !== '') {
    const slug = slugify(text(body.slug, 'Permalink', 200));
    if (!SLUG.test(slug)) throw new BadRequest('Permalink must contain letters or numbers');
    update.slug = slug;
  }
  return update;
}

function parseUpload(body) {
  if (!body || typeof body !== 'object') throw new BadRequest('Expected a JSON object');
  const name = text(body.name, 'File name', 200).replace(/[\\/]/g, '_');
  if (!name) throw new BadRequest('File name is required');
  const size = Number(body.size);
  if (!Number.isInteger(size) || size < 1) throw new BadRequest('File is empty');
  if (size > MAX_FILE_BYTES) throw new BadRequest(`Files can be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const type = typeof body.type === 'string' && MIME_TYPE.test(body.type) && body.type.length <= 100
    ? body.type.toLowerCase() : 'application/octet-stream';
  return { name, size, type };
}

// Markdown to plain text, for excerpts and search.
function plainText(markdown) {
  return String(markdown || '')
    .replace(/^\s*(```|~~~)[^\n]*\n[\s\S]*?(\n\s*\1\s*(\n|$)|$)/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d{1,9}[.)])\s+/gm, '')
    .replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm, ' ')
    .replace(/[*_`~]+/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function excerptOf(markdown) {
  const plain = plainText(markdown);
  if (plain.length <= EXCERPT_LENGTH) return plain;
  const cut = plain.slice(0, EXCERPT_LENGTH);
  const space = cut.lastIndexOf(' ');
  return `${(space > EXCERPT_LENGTH * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

const isImageType = (type) => /^image\/(png|jpe?g|gif|webp|avif)$/.test(type || '');

const fileList = (item) => Object.entries(item.files || {})
  .map(([id, file]) => ({ id, ...file }))
  .sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)) || a.id.localeCompare(b.id));

// The first picture in the post, else the first picture attached to it.
function coverOf(item) {
  const match = /!\[[^\]]*\]\((\/media\/[^\s)]+)/.exec(item.body || '');
  if (match) return match[1];
  const image = fileList(item).find((file) => isImageType(file.type));
  return image ? image.url : '';
}

// Values kept on the item so the post list and the public index don't need the full body.
function derive(item) {
  item.excerpt = excerptOf(item.body);
  item.cover = coverOf(item);
  return item;
}

const publicFile = ({ id, name, type, size, url }) => ({ id, name, type, size, url });

function toApiPost(item) {
  const { files, ...rest } = item;
  return { ...rest, title: item.title || '', body: item.body || '', files: fileList(item).map((file) => ({ ...publicFile(file), uploadedAt: file.uploadedAt })) };
}

function toSummary(item) {
  return {
    id: item.id,
    title: item.title || '',
    status: item.status,
    slug: item.slug || '',
    authorName: item.authorName || '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    publishedAt: item.publishedAt || '',
  };
}

function toPublicPost(item) {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title || '',
    body: item.body || '',
    authorName: item.authorName || '',
    publishedAt: item.publishedAt,
    updatedAt: item.updatedAt,
    files: fileList(item).map(publicFile),
  };
}

function toIndexEntry(item) {
  return {
    slug: item.slug,
    title: item.title || '',
    excerpt: item.excerpt || '',
    cover: item.cover || '',
    authorName: item.authorName || '',
    publishedAt: item.publishedAt,
  };
}

function buildIndex(items, now) {
  const posts = items
    .filter((item) => item.status === 'published' && item.slug)
    .map(toIndexEntry)
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return { generatedAt: now, posts };
}

const compareSummaries = (a, b) => String(b.publishedAt || b.updatedAt).localeCompare(String(a.publishedAt || a.updatedAt));

module.exports = {
  BadRequest,
  FILE_ID,
  MAX_FILE_BYTES,
  MAX_FILES,
  POST_ID,
  SLUG,
  buildIndex,
  compareSummaries,
  derive,
  excerptOf,
  fileList,
  isImageType,
  newFileId,
  newPostId,
  parsePostUpdate,
  parseUpload,
  plainText,
  slugify,
  toApiPost,
  toIndexEntry,
  toPublicPost,
  toSummary,
};
