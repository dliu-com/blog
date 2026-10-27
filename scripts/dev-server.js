#!/usr/bin/env node
'use strict';

// Local preview: serves web/ and runs the real API handler against in-memory storage.
// Sign-in is faked: /auth/login signs you in as a dev user without Microsoft.
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PORT = Number(process.env.PORT || 8787);
const SITE_URL = `http://localhost:${PORT}`;
process.env.SITE_URL = SITE_URL;

const auth = require('../lambda/api/auth');
const { createHandler } = require('../lambda/api/index');
const { createMemoryFiles } = require('./memory-files');
const { createMemoryStore } = require('./memory-store');

const config = { tenantId: 'dev', clientId: 'dev', clientSecret: 'dev-secret', allowedDomain: 'dliu.com' };
const store = createMemoryStore();
const files = createMemoryFiles();
const handler = createHandler({ store, files, loadConfig: async () => config });
const viewerRequest = vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'functions', 'viewer-request.js'), 'utf8')}\nhandler`);
const WEB = path.join(__dirname, '..', 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
// Local cookies can't use the __Host- prefix over plain http, so rename them on the way in and out.
const LOCAL_SESSION = 'blog_dev_session';

function sessionCookie() {
  const value = auth.sign({ user: 'dev@example.com', name: 'Dewei Liu', exp: Math.floor(Date.now() / 1000) + 86400 }, auth.sessionKey(config));
  return `${LOCAL_SESSION}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

function toLambdaEvent(req, body) {
  const url = new URL(req.url, SITE_URL);
  const cookieHeader = (req.headers.cookie || '').replace(new RegExp(`\\b${LOCAL_SESSION}=`), `${auth.SESSION_COOKIE}=`);
  return {
    rawPath: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers: { ...req.headers, cookie: cookieHeader },
    requestContext: { http: { method: req.method } },
    body: body.length ? body.toString('base64') : undefined,
    isBase64Encoded: true,
  };
}

async function readAll(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function seed() {
  const call = async (method, url, body) => {
    const cookie = sessionCookie().split(';')[0];
    const res = await handler(toLambdaEvent({
      url, method, headers: { cookie, origin: SITE_URL, 'content-type': 'application/json' },
    }, Buffer.from(body ? JSON.stringify(body) : '')));
    return JSON.parse(res.body);
  };
  const welcome = await call('POST', '/api/posts', {
    title: 'Welcome to the new blog',
    body: 'This blog no longer runs a server around the clock. Pages are **static files** on CloudFront, '
      + 'and a small function only wakes up when someone signs in to write.\n\n'
      + '## What you can do\n\n- Write posts in Markdown\n- Attach *pictures* and files\n- Save drafts and publish when ready\n\n'
      + '> Sign in from the **Log in** link in the sidebar to try the editor.',
  });
  await call('PUT', `/api/posts/${welcome.id}`, { status: 'published' });
  const trip = await call('POST', '/api/posts', {
    title: 'Easter trips to Ireland',
    body: 'A long weekend on the west coast: Galway, the Cliffs of Moher and the Burren.\n\n'
      + 'Day one was rainy, day two was glorious. See [the route](https://www.openstreetmap.org/) we took.',
  });
  await call('PUT', `/api/posts/${trip.id}`, { status: 'published' });
  await call('POST', '/api/posts', { title: 'Draft: Halloween trip', body: 'Notes to finish later.' });
}

async function handle(req, res) {
  const url = new URL(req.url, SITE_URL);
  if (url.pathname === '/auth/login') {
    res.writeHead(302, {
      location: auth.safeReturnPath(url.searchParams.get('return') || '/admin'),
      'set-cookie': [sessionCookie(), `${auth.HINT_COOKIE}=1; Path=/; SameSite=Lax`],
    });
    return res.end();
  }
  if (url.pathname === '/auth/logout') {
    res.writeHead(302, {
      location: auth.safeReturnPath(url.searchParams.get('return')),
      'set-cookie': [`${LOCAL_SESSION}=; Path=/; Max-Age=0`, `${auth.HINT_COOKIE}=; Path=/; Max-Age=0`],
    });
    return res.end();
  }
  // Stand-in for presigned PUTs to the bucket's pending/ prefix.
  if (url.pathname.startsWith('/dev-files/pending/') && req.method === 'PUT') {
    files.put(decodeURIComponent(url.pathname.slice('/dev-files/'.length)), await readAll(req), req.headers['content-type']);
    res.writeHead(200);
    return res.end();
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    const result = await handler(toLambdaEvent(req, await readAll(req)));
    const headers = { ...result.headers };
    if (result.cookies) headers['set-cookie'] = result.cookies;
    res.writeHead(result.statusCode, headers);
    return res.end(result.body);
  }
  if (url.pathname.startsWith('/content/') || url.pathname.startsWith('/media/')) {
    const object = files.objects.get(decodeURIComponent(url.pathname.slice(1)));
    if (!object) {
      res.writeHead(403);
      return res.end('Access denied');
    }
    res.writeHead(200, { 'content-type': object.type, 'x-content-type-options': 'nosniff', ...object.headers });
    return res.end(object.body);
  }
  // Same rewrites and redirects as the CloudFront function.
  const result = viewerRequest({ request: { uri: url.pathname, headers: {} } });
  if (result.statusCode) {
    res.writeHead(result.statusCode, { location: result.headers.location.value });
    return res.end();
  }
  const file = path.join(WEB, path.normalize(result.uri === '/' ? '/index.html' : result.uri));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(403);
    return res.end('Access denied');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

seed().then(() => {
  http.createServer((req, res) => handle(req, res).catch((error) => {
    console.error(error);
    res.writeHead(500);
    res.end('Internal error');
  })).listen(PORT, () => console.log(`Blog dev server: ${SITE_URL} (Log in = fake dev user)`));
});
