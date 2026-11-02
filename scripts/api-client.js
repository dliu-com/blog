#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const routes = require('../lambda/api/routes.json');

// Concrete paths only: /api/posts/2026102801 matches "/api/posts/{postId}".
const SEGMENTS = { '{postId}': /^\d{10}$/, '{fileId}': /^[A-Za-z0-9_-]{16}$/ };
function isRoute(method, apiPath) {
  if (typeof apiPath !== 'string' || !apiPath.startsWith('/api/')) return false;
  const parts = apiPath.split('/');
  return Object.keys(routes).some((route) => {
    const [routeMethod, template] = route.split(' ');
    const expected = template.split('/');
    return routeMethod === method && expected.length === parts.length &&
      expected.every((segment, index) => (SEGMENTS[segment] ? SEGMENTS[segment].test(parts[index]) : segment === parts[index]));
  });
}

function readConfig(env = process.env) {
  if (typeof env.BLOG_API_URL !== 'string' || !env.BLOG_API_URL) {
    throw new Error('Set BLOG_API_URL to the managed API origin from https://blog.dliu.com/docs/api.md');
  }
  const endpoint = new URL(env.BLOG_API_URL);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('BLOG_API_URL must be an HTTPS API origin without a path or credentials');
  }
  if (Object.hasOwn(env, 'BLOG_API_ACCESS_TOKEN')) {
    if (typeof env.BLOG_API_ACCESS_TOKEN !== 'string' ||
        !/^[A-Za-z0-9._~+\/-]+=*$/.test(env.BLOG_API_ACCESS_TOKEN)) {
      throw new Error('BLOG_API_ACCESS_TOKEN must contain only bearer-token characters');
    }
    return { endpoint: endpoint.origin, accessToken: env.BLOG_API_ACCESS_TOKEN };
  }
  // Tokens come only from auth.dliu.com (copied, or saved with Save file); this client never signs in itself.
  const credentialFile = Object.hasOwn(env, 'BLOG_API_TOKEN_FILE') ? env.BLOG_API_TOKEN_FILE :
    path.join(env.HOME || os.homedir(), '.dliu_token');
  if (typeof credentialFile !== 'string' || !path.isAbsolute(credentialFile) || credentialFile.includes('\0')) {
    throw new Error('BLOG_API_TOKEN_FILE must be an absolute credential-file path');
  }
  return { endpoint: endpoint.origin, credentialFile };
}

function readAccessToken(config, now = Date.now()) {
  if (config.accessToken) return config.accessToken;
  if (!config.credentialFile) throw new Error('Use a saved or copied token from auth.dliu.com for this request');
  let content;
  try {
    content = fs.readFileSync(config.credentialFile, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read credential file (${error.code || 'read failed'}); use Save file at auth.dliu.com`);
  }
  const fields = {};
  for (const line of content.split(/\r?\n/).filter((value) => value !== '')) {
    const index = line.indexOf('=');
    const name = line.slice(0, index);
    if (index < 1 || !['token', 'expires_at'].includes(name) || Object.hasOwn(fields, name)) {
      throw new Error('Credential file needs exactly one token= line and one expires_at= UTC line; use Save file at auth.dliu.com');
    }
    fields[name] = line.slice(index + 1);
  }
  if (Object.keys(fields).length !== 2) {
    throw new Error('Credential file needs exactly one token= line and one expires_at= UTC line; use Save file at auth.dliu.com');
  }
  const token = fields.token;
  const parts = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token.split('.') : [];
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0] || '', 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1] || '', 'base64url').toString('utf8'));
  } catch {
    throw new Error('Credential file token must be a JWT access token with an integer exp; save a fresh file at auth.dliu.com');
  }
  if (!header || typeof header.alg !== 'string' || !header.alg ||
      !claims || !Number.isSafeInteger(claims.exp) || claims.exp <= 0 || !Number.isSafeInteger(claims.exp * 1000)) {
    throw new Error('Credential file token must be a JWT access token with an integer exp; save a fresh file at auth.dliu.com');
  }
  const expiresAt = Date.parse(fields.expires_at);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(fields.expires_at) ||
      !Number.isFinite(expiresAt) || new Date(expiresAt).toISOString() !==
      (fields.expires_at.includes('.') ? fields.expires_at : fields.expires_at.replace('Z', '.000Z'))) {
    throw new Error('Credential file expires_at must be a valid ISO UTC timestamp; use Save file at auth.dliu.com');
  }
  // Local expiry checks do not verify the JWT signature or replace gateway authorization.
  if (Math.min(expiresAt, claims.exp * 1000) <= now) {
    throw new Error('Saved Microsoft access token has expired; obtain a fresh token and save the file again at auth.dliu.com');
  }
  return token;
}

function createClient(config, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const token = async () => readAccessToken(config, (deps.now || Date.now)());

  async function request(method, apiPath, body) {
    if (!isRoute(method, apiPath)) throw new Error('Unknown Blog API method or path');
    const response = await fetchImpl(config.endpoint + apiPath, {
      method,
      redirect: 'error',
      headers: { authorization: `Bearer ${await token()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`Blog API ${response.status}: ${result.error || result.message || 'Request failed'}`);
    return result;
  }

  // Start an upload, PUT the bytes to the presigned S3 URL (no bearer token goes to S3), then attach it.
  async function upload(postId, filePath, type) {
    const data = await fs.promises.readFile(filePath);
    const name = path.basename(filePath);
    const start = await request('POST', `/api/posts/${postId}/files`, { name, size: data.length, type });
    const put = await fetchImpl(start.uploadUrl, { method: 'PUT', redirect: 'error', headers: start.uploadHeaders, body: data });
    if (!put.ok) throw new Error(`Upload to storage failed (${put.status})`);
    const post = await request('PUT', `/api/posts/${postId}/files/${start.fileId}`, { name });
    return post.files.find((file) => file.id === start.fileId);
  }
  return { request, upload };
}

const USAGE = 'Usage: node scripts/api-client.js [METHOD /api/path [JSON]] | upload <postId> <file> <mime-type>';

async function main(args = process.argv.slice(2)) {
  const client = createClient(readConfig());
  if (args[0] === 'upload') {
    if (args.length !== 4) throw new Error(USAGE);
    console.log(JSON.stringify(await client.upload(args[1], args[2], args[3]), null, 2));
    return;
  }
  const [method = 'GET', apiPath = '/api/me', text] = args;
  if (args.length > 3) throw new Error(USAGE);
  console.log(JSON.stringify(await client.request(method, apiPath, text === undefined ? undefined : JSON.parse(text)), null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { readConfig, readAccessToken, createClient, isRoute, main };
