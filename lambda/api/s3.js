'use strict';

// One private bucket holds everything the API writes:
//   pending/<postId>/<fileId>              browser uploads (presigned PUT), expire after a day
//   media/<postId>/<fileId>/<name>         kept attachments, served by CloudFront at /media/...
//   content/index.json, content/posts/*    published posts as static JSON, served at /content/...
// Readers only ever touch CloudFront; the Lambda runs when an author writes.
const crypto = require('crypto');

const UPLOAD_PREFIX = 'pending/';
const MEDIA_PREFIX = 'media/';
const CONTENT_PREFIX = 'content/';
const UPLOAD_SECONDS = 15 * 60;
// Shown in the browser; anything else (and anything that could run script, like HTML or SVG) downloads instead.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|heic|heif)|application\/pdf|text\/plain|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/;
const MEDIA_CACHE = 'public, max-age=86400';
const CONTENT_CACHE = 'no-cache';

const uploadKey = (postId, fileId) => `${UPLOAD_PREFIX}${postId}/${fileId}`;
const mediaPrefix = (postId) => `${MEDIA_PREFIX}${postId}/`;

// RFC 3986 encoding, as SigV4 expects.
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256 = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

// SigV4 query-string signing (https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html).
function presignUrl({ method, host, key, region, credentials, expires, date, query = {}, headers = {} }) {
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const signed = { host, ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()])) };
  const names = Object.keys(signed).sort();
  const params = {
    ...query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': names.join(';'),
    ...(credentials.sessionToken ? { 'X-Amz-Security-Token': credentials.sessionToken } : {}),
  };
  const canonicalQuery = Object.entries(params)
    .map(([name, value]) => [encode(name), encode(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const path = `/${key.split('/').map(encode).join('/')}`;
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    names.map((name) => `${name}:${signed[name]}\n`).join(''),
    names.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = ['s3', 'aws4_request'].reduce(hmac, hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region));
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// Content-Disposition with a plain-ASCII fallback name and the real (UTF-8) name.
function contentDisposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encode(name)}`;
}

const isInline = (type) => INLINE_TYPES.test(type);
const servedType = (type) => (isInline(type) ? type : 'application/octet-stream');

// A URL-safe object name that keeps the extension: "Café menu (1).JPG" -> "Cafe-menu-1.jpg".
function storageName(name) {
  const ext = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  const base = (ext ? name.slice(0, -ext[0].length) : name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'file';
  return ext ? `${base}.${ext[1].toLowerCase()}` : base;
}

function mediaKey(postId, fileId, name) {
  return `${MEDIA_PREFIX}${postId}/${fileId}/${storageName(name)}`;
}

// How a kept file is served from /media/.
function mediaHeaders({ name, type }) {
  const inline = isInline(type);
  return {
    ContentType: servedType(type),
    ContentDisposition: contentDisposition(inline ? 'inline' : 'attachment', name),
    CacheControl: MEDIA_CACHE,
  };
}

function createFiles({
  bucket = process.env.CONTENT_BUCKET,
  region = process.env.AWS_REGION,
  client,
  credentials = () => ({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  }),
  now = () => new Date(),
} = {}) {
  let s3;
  const lib = () => require('@aws-sdk/client-s3');
  const send = (command) => {
    s3 = s3 || client || new (lib().S3Client)({ region });
    return s3.send(command);
  };
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const sign = (options) => presignUrl({ host, region, credentials: credentials(), date: now(), ...options });

  async function removePrefix(Prefix) {
    const { DeleteObjectsCommand, ListObjectsV2Command } = lib();
    let ContinuationToken;
    do {
      const page = await send(new ListObjectsV2Command({ Bucket: bucket, Prefix, ContinuationToken }));
      const objects = (page.Contents || []).map(({ Key }) => ({ Key }));
      if (objects.length) await send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }));
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
  }

  return {
    origin: `https://${host}`,

    uploadUrl(postId, fileId, { size, type }) {
      return {
        url: sign({ method: 'PUT', key: uploadKey(postId, fileId), expires: UPLOAD_SECONDS, headers: { 'content-length': size, 'content-type': type } }),
        headers: { 'content-type': type },
      };
    },

    // Size and type of a finished upload, or null if nothing arrived.
    async uploaded(postId, fileId) {
      try {
        const head = await send(new (lib().HeadObjectCommand)({ Bucket: bucket, Key: uploadKey(postId, fileId) }));
        return { size: head.ContentLength, type: head.ContentType || 'application/octet-stream' };
      } catch (error) {
        if (error.name === 'NotFound' || error.name === 'NoSuchKey' || (error.$metadata && error.$metadata.httpStatusCode === 404)) return null;
        throw error;
      }
    },

    // Move a finished upload out of pending/ into media/, with headers that make it safe to serve.
    async keep(postId, fileId, file, key) {
      const { CopyObjectCommand, DeleteObjectCommand } = lib();
      await send(new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${uploadKey(postId, fileId)}`,
        Key: key,
        MetadataDirective: 'REPLACE',
        ...mediaHeaders(file),
      }));
      await send(new DeleteObjectCommand({ Bucket: bucket, Key: uploadKey(postId, fileId) }));
    },

    async remove(key) {
      await send(new (lib().DeleteObjectCommand)({ Bucket: bucket, Key: key }));
    },

    async removePost(postId) {
      await removePrefix(mediaPrefix(postId));
    },

    async putContent(path, data) {
      await send(new (lib().PutObjectCommand)({
        Bucket: bucket,
        Key: `${CONTENT_PREFIX}${path}`,
        Body: JSON.stringify(data),
        ContentType: 'application/json; charset=utf-8',
        CacheControl: CONTENT_CACHE,
      }));
    },

    async deleteContent(path) {
      await send(new (lib().DeleteObjectCommand)({ Bucket: bucket, Key: `${CONTENT_PREFIX}${path}` }));
    },
  };
}

const mediaUrl = (key) => `/${key.split('/').map(encode).join('/')}`;

module.exports = {
  CONTENT_CACHE,
  MEDIA_CACHE,
  createFiles,
  mediaHeaders,
  mediaKey,
  mediaUrl,
  presignUrl,
  servedType,
  storageName,
  uploadKey,
};
