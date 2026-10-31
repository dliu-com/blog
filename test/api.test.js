'use strict';

const SITE_URL = 'https://blog.dliu.com';
process.env.SITE_URL = SITE_URL;

const auth = require('../lambda/api/auth');
const { createHandler } = require('../lambda/api/index');
const { NotConfigured } = require('../lambda/api/config');
const { createMemoryFiles } = require('../scripts/memory-files');
const { createMemoryStore } = require('../scripts/memory-store');

const NOW = Date.UTC(2026, 9, 1, 12);
const config = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret', allowedDomain: 'dliu.com' };

function setup() {
  const store = createMemoryStore();
  const files = createMemoryFiles();
  let clock = NOW;
  const handler = createHandler({ store, files, loadConfig: async () => config, now: () => clock });
  const session = auth.issueSession({ user: 'user@example.com', name: 'Dewei' }, config, NOW);

  function call(method, path, { body, signedIn = true, origin = SITE_URL, contentType = 'application/json', token, headers: extra = {} } = {}) {
    const headers = { ...extra };
    if (token) headers.authorization = `Bearer ${token}`;
    if (origin) headers.origin = origin;
    if (body !== undefined) headers['content-type'] = contentType;
    return handler({
      rawPath: path.split('?')[0],
      queryStringParameters: Object.fromEntries(new URL(path, SITE_URL).searchParams),
      headers,
      cookies: signedIn ? [`${auth.SESSION_COOKIE}=${session}`] : [],
      requestContext: { http: { method } },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }).then((res) => ({ ...res, json: res.body && !res.body.startsWith('<') ? JSON.parse(res.body) : {} }));
  }

  return { store, files, call, tick: (ms = 60000) => { clock += ms; } };
}

async function createPost(call, fields = {}) {
  const res = await call('POST', '/api/posts', { body: fields });
  expect(res.statusCode).toBe(201);
  return res.json;
}

async function upload(call, files, postId, { name = 'photo.jpg', type = 'image/jpeg', body = 'jpeg-bytes' } = {}) {
  const start = await call('POST', `/api/posts/${postId}/files`, { body: { name, size: Buffer.byteLength(body), type } });
  expect(start.statusCode).toBe(201);
  expect(start.json.uploadHeaders).toEqual({ 'content-type': type });
  files.put(start.json.uploadUrl.replace('/dev-files/', ''), body, type);
  const done = await call('PUT', `/api/posts/${postId}/files/${start.json.fileId}`, { body: { name } });
  return { fileId: start.json.fileId, done };
}

describe('/api/me', () => {
  test('reports signed-in state', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/me')).json).toEqual({ signedIn: true, user: 'user@example.com', name: 'Dewei' });
    expect((await call('GET', '/api/me', { signedIn: false })).json).toEqual({ signedIn: false });
  });

  test('works before secrets are configured', async () => {
    const handler = createHandler({ store: createMemoryStore(), files: createMemoryFiles(), loadConfig: async () => { throw new NotConfigured('missing'); } });
    const res = await handler({ rawPath: '/api/me', requestContext: { http: { method: 'GET' } } });
    expect(JSON.parse(res.body)).toEqual({ signedIn: false, configured: false });
  });
});

describe('session forgery', () => {
  function withCookie(handler, value, method = 'GET', path = '/api/tokens') {
    return handler({
      rawPath: path,
      headers: { origin: SITE_URL, 'content-type': 'application/json' },
      cookies: [`${auth.SESSION_COOKIE}=${value}`],
      requestContext: { http: { method } },
      body: method === 'GET' ? undefined : '{"name":"x","expiresInDays":0}',
    });
  }
  const handler = () => createHandler({ store: createMemoryStore(), files: createMemoryFiles(), loadConfig: async () => config, now: () => NOW });

  test('the login cookie from /auth/login is not accepted as a session', async () => {
    const login = auth.startLogin(config, SITE_URL, NOW, '/admin');
    const value = login.cookies[0].split(';')[0].split('=').slice(1).join('=');
    const h = handler();
    expect((await withCookie(h, value)).statusCode).toBe(401);
    expect((await withCookie(h, value, 'POST')).statusCode).toBe(401);
    expect(JSON.parse((await withCookie(h, value, 'GET', '/api/me')).body)).toEqual({ signedIn: false });
  });

  test('signed payloads without the session type or a user are rejected', async () => {
    const exp = NOW / 1000 + 3600;
    const h = handler();
    for (const payload of [{ user: 'user@example.com', exp }, { typ: 'session', exp }, { typ: 'session', user: '', exp }, { typ: 'login', user: 'user@example.com', exp }]) {
      expect((await withCookie(h, auth.sign(payload, auth.sessionKey(config)))).statusCode).toBe(401);
    }
    expect((await withCookie(h, auth.sign({ typ: 'session', user: 'user@example.com', exp }, auth.loginKey(config)))).statusCode).toBe(401);
    expect((await withCookie(h, auth.issueSession({ user: 'user@example.com' }, config, NOW))).statusCode).toBe(200);
  });
});

describe('authors only', () => {
  test('anonymous visitors cannot list, read or change posts', async () => {
    const { call } = setup();
    const post = await createPost(call, { title: 'Secret draft' });
    for (const [method, path, body] of [
      ['GET', '/api/posts'],
      ['GET', `/api/posts/${post.id}`],
      ['POST', '/api/posts', {}],
      ['PUT', `/api/posts/${post.id}`, { status: 'published' }],
      ['DELETE', `/api/posts/${post.id}`],
      ['POST', `/api/posts/${post.id}/files`, { name: 'a.png', size: 1, type: 'image/png' }],
    ]) {
      expect((await call(method, path, { body, signedIn: false })).statusCode).toBe(401);
    }
  });

  test('writes must come from the site itself and be JSON', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/posts', { body: {}, origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await call('POST', '/api/posts', { body: {}, origin: null })).statusCode).toBe(403);
    expect((await call('POST', '/api/posts', { body: 'title=x', contentType: 'application/x-www-form-urlencoded' })).statusCode).toBe(415);
  });

  test('unknown ids and routes are 404s', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/posts/nope')).statusCode).toBe(404);
    expect((await call('GET', '/api/posts/2026010199')).statusCode).toBe(404);
    expect((await call('GET', '/api/other')).statusCode).toBe(404);
  });
});

describe('post ids', () => {
  test('are the UTC date and a number for that day', async () => {
    const { call, store, tick } = setup();
    expect((await createPost(call)).id).toBe('2026100100');
    expect((await createPost(call)).id).toBe('2026100101');
    const third = await createPost(call);
    expect(third.id).toBe('2026100102');
    await call('DELETE', `/api/posts/${third.id}`);
    expect((await createPost(call)).id).toBe('2026100102');
    tick(12 * 3600 * 1000);
    expect((await createPost(call)).id).toBe('2026100200');
    expect([...store.posts.keys()].sort()).toEqual(['2026100100', '2026100101', '2026100102', '2026100200']);
  });

  test('skip a number taken by a concurrent create', async () => {
    const { call, store } = setup();
    const listPosts = store.listPosts;
    store.listPosts = async () => [];
    store.posts.set('2026100100', { id: '2026100100', title: 'Racing', status: 'draft', files: {} });
    expect((await createPost(call)).id).toBe('2026100101');
    store.listPosts = listPosts;
  });

  test('allow 100 posts a day', async () => {
    const { call, store } = setup();
    for (let n = 0; n < 100; n += 1) store.posts.set(`20261001${String(n).padStart(2, '0')}`, { id: `20261001${String(n).padStart(2, '0')}`, status: 'draft', files: {} });
    const res = await call('POST', '/api/posts', { body: {} });
    expect(res.statusCode).toBe(409);
  });
});

describe('writing and publishing', () => {
  test('drafts stay private until published', async () => {
    const { call, files } = setup();
    const post = await createPost(call, { title: 'Easter trip' });
    expect(post).toMatchObject({ title: 'Easter trip', body: '', status: 'draft', author: 'user@example.com', authorName: 'Dewei', files: [] });
    expect(post.id).toBe('2026100100');
    expect(files.objects.size).toBe(0);

    const saved = await call('PUT', `/api/posts/${post.id}`, { body: { body: 'Day one in **Galway**.' } });
    expect(saved.json).toMatchObject({ title: 'Easter trip', body: 'Day one in **Galway**.', excerpt: 'Day one in Galway.' });
    expect(files.objects.size).toBe(0);

    const list = await call('GET', '/api/posts');
    expect(list.json.posts).toEqual([expect.objectContaining({ id: post.id, title: 'Easter trip', status: 'draft' })]);
  });

  test('publishing writes the post and the index as static JSON, by post id', async () => {
    const { call, files } = setup();
    const post = await createPost(call, { title: 'Easter trip to Ireland', body: 'Hello\n\n![cliffs](/media/x/y/cliffs.jpg)' });
    const res = await call('PUT', `/api/posts/${post.id}`, { body: { status: 'published' } });
    expect(res.json).toMatchObject({ id: '2026100100', status: 'published', publishedAt: new Date(NOW).toISOString() });
    expect(res.json).not.toHaveProperty('slug');

    expect(files.json('posts/2026100100.json')).toEqual({
      id: '2026100100',
      title: 'Easter trip to Ireland',
      body: 'Hello\n\n![cliffs](/media/x/y/cliffs.jpg)',
      authorName: 'Dewei',
      publishedAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      files: [],
    });
    expect(files.json('index.json')).toEqual({
      generatedAt: new Date(NOW).toISOString(),
      posts: [{ id: '2026100100', title: 'Easter trip to Ireland', excerpt: 'Hello', cover: '/media/x/y/cliffs.jpg', authorName: 'Dewei', publishedAt: new Date(NOW).toISOString() }],
    });
    expect(files.objects.get('content/index.json').headers['cache-control']).toBe('no-cache');
  });

  test('the index lists published posts newest first and keeps the first publish date', async () => {
    const { call, files, tick } = setup();
    const first = await createPost(call, { title: 'First' });
    await call('PUT', `/api/posts/${first.id}`, { body: { status: 'published' } });
    tick();
    const second = await createPost(call, { title: 'Second' });
    await call('PUT', `/api/posts/${second.id}`, { body: { status: 'published' } });
    await createPost(call, { title: 'Still a draft' });
    expect(files.json('index.json').posts.map((p) => p.title)).toEqual(['Second', 'First']);

    tick();
    const edited = await call('PUT', `/api/posts/${first.id}`, { body: { title: 'First, edited', status: 'published' } });
    expect(edited.json.publishedAt).toBe(new Date(NOW).toISOString());
    expect(files.json(`posts/${first.id}.json`).title).toBe('First, edited');
  });

  test('an old slug field is ignored', async () => {
    const { call } = setup();
    const post = await createPost(call, { title: 'Trip' });
    const res = await call('PUT', `/api/posts/${post.id}`, { body: { slug: 'my-trip', status: 'published' } });
    expect(res.statusCode).toBe(200);
    expect(res.json).not.toHaveProperty('slug');
  });

  test('switching back to draft or deleting removes the public copy', async () => {
    const { call, files } = setup();
    const a = await createPost(call, { title: 'Alpha' });
    const b = await createPost(call, { title: 'Beta' });
    await call('PUT', `/api/posts/${a.id}`, { body: { status: 'published' } });
    await call('PUT', `/api/posts/${b.id}`, { body: { status: 'published' } });

    await call('PUT', `/api/posts/${a.id}`, { body: { status: 'draft' } });
    expect(files.json(`posts/${a.id}.json`)).toBeNull();
    expect(files.json('index.json').posts.map((p) => p.id)).toEqual([b.id]);

    expect((await call('DELETE', `/api/posts/${b.id}`)).json).toEqual({ deleted: b.id });
    expect(files.json(`posts/${b.id}.json`)).toBeNull();
    expect(files.json('index.json').posts).toEqual([]);
    expect((await call('GET', `/api/posts/${b.id}`)).statusCode).toBe(404);
  });

  test('validates input', async () => {
    const { call } = setup();
    const post = await createPost(call);
    expect((await call('PUT', `/api/posts/${post.id}`, { body: { status: 'scheduled' } })).statusCode).toBe(400);
    expect((await call('PUT', `/api/posts/${post.id}`, { body: { title: 'x'.repeat(201) } })).statusCode).toBe(400);
    expect((await call('PUT', `/api/posts/${post.id}`, { body: { body: 'x'.repeat(250 * 1024) } })).statusCode).toBe(400);
    expect((await call('PUT', `/api/posts/${post.id}`, { body: '{oops' })).statusCode).toBe(400);
    expect((await call('PUT', `/api/posts/${post.id}`, { body: { title: '  Spaced\n title ' } })).json.title).toBe('Spaced title');
  });
});

describe('files', () => {
  test('upload, publish with attachments, and remove', async () => {
    const { call, files } = setup();
    const post = await createPost(call, { title: 'Photos' });
    const { fileId, done } = await upload(call, files, post.id, { name: 'Cliffs of Moher.JPG' });
    expect(done.statusCode).toBe(201);
    const key = `media/${post.id}/${fileId}/Cliffs-of-Moher.jpg`;
    expect(done.json.files).toEqual([{ id: fileId, name: 'Cliffs of Moher.JPG', type: 'image/jpeg', size: 10, url: `/${key}`, uploadedAt: expect.any(String) }]);
    expect(done.json.cover).toBe(`/${key}`);
    expect([...files.objects.keys()]).toEqual([key]);
    expect(files.objects.get(key).headers['content-disposition']).toMatch(/^inline;/);

    // Confirming twice is harmless.
    expect((await call('PUT', `/api/posts/${post.id}/files/${fileId}`, { body: { name: 'x' } })).json.files).toHaveLength(1);

    await call('PUT', `/api/posts/${post.id}`, { body: { status: 'published' } });
    expect(files.json(`posts/${post.id}.json`).files).toEqual([{ id: fileId, name: 'Cliffs of Moher.JPG', type: 'image/jpeg', size: 10, url: `/${key}` }]);

    const removed = await call('DELETE', `/api/posts/${post.id}/files/${fileId}`);
    expect(removed.json.files).toEqual([]);
    expect(files.objects.has(key)).toBe(false);
    expect(files.json(`posts/${post.id}.json`).files).toEqual([]);
    expect(files.json('index.json').posts[0].cover).toBe('');
  });

  test('risky types are served as downloads', async () => {
    const { call, files } = setup();
    const post = await createPost(call);
    for (const [name, type] of [['x.svg', 'image/svg+xml'], ['x.html', 'text/html']]) {
      const { done } = await upload(call, files, post.id, { name, type, body: '<script>alert(1)</script>' });
      const file = done.json.files.find((f) => f.name === name);
      expect(file.type).toBe('application/octet-stream');
      expect(files.objects.get(file.url.slice(1)).headers['content-disposition']).toMatch(/^attachment;/);
    }
    const { done } = await upload(call, files, post.id, { name: 'menu.pdf', type: 'application/pdf', body: '%PDF' });
    expect(done.json.files.find((f) => f.name === 'menu.pdf').type).toBe('application/pdf');
  });

  test('a missing upload cannot be confirmed; oversized files are refused', async () => {
    const { call } = setup();
    const post = await createPost(call);
    const start = await call('POST', `/api/posts/${post.id}/files`, { body: { name: 'a.png', size: 3, type: 'image/png' } });
    expect((await call('PUT', `/api/posts/${post.id}/files/${start.json.fileId}`, { body: { name: 'a.png' } })).statusCode).toBe(404);
    expect((await call('POST', `/api/posts/${post.id}/files`, { body: { name: 'big.mov', size: 101 * 1024 * 1024, type: 'video/quicktime' } })).statusCode).toBe(400);
    expect((await call('POST', `/api/posts/${post.id}/files`, { body: { name: 'empty', size: 0 } })).statusCode).toBe(400);
  });

  test('deleting a post deletes its media', async () => {
    const { call, files } = setup();
    const post = await createPost(call);
    const other = await createPost(call);
    await upload(call, files, post.id);
    await upload(call, files, other.id);
    await call('DELETE', `/api/posts/${post.id}`);
    expect([...files.objects.keys()].every((key) => key.startsWith(`media/${other.id}/`))).toBe(true);
    expect(files.objects.size).toBe(1);
  });
});

describe('sign-in routes', () => {
  test('login redirects to Microsoft and logout clears the cookies', async () => {
    const { call } = setup();
    const login = await call('GET', '/auth/login?return=/admin/new', { signedIn: false });
    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\/tenant\/oauth2\/v2\.0\/authorize\?/);
    expect(new URL(login.headers.location).searchParams.get('redirect_uri')).toBe(`${SITE_URL}/auth/callback`);

    const logout = await call('GET', '/auth/logout?return=//evil.example', { signedIn: false });
    expect(logout.statusCode).toBe(302);
    expect(logout.headers.location).toBe('/');
    expect(logout.cookies.join('\n')).toMatch(new RegExp(`${auth.SESSION_COOKIE}=;`));
    expect(logout.cookies.join('\n')).toMatch(/blog_signed_in=;/);
  });
});

describe('API tokens', () => {
  async function newToken(call, body = { name: 'Writer agent' }) {
    const res = await call('POST', '/api/tokens', { body });
    expect(res.statusCode).toBe(201);
    return res.json;
  }
  // Agents call from outside the browser: a token, no cookie and no Origin header.
  const asAgent = (call, token) => (method, path, options = {}) => call(method, path, { ...options, token, signedIn: false, origin: null });

  test('the owner creates, lists and revokes tokens; the secret is shown once and only its hash is stored', async () => {
    const { call, store } = setup();
    const created = await newToken(call, { name: '  Writer   agent ', expiresInDays: 30 });
    expect(created.token).toMatch(/^blog_[a-f0-9]{12}_[a-f0-9]{64}$/);
    expect(created).toMatchObject({ name: 'Writer agent', createdByName: 'Dewei', expiresAt: new Date(NOW + 30 * 86400000).toISOString(), lastUsedAt: '' });
    const stored = store.tokens.get(created.id);
    expect(JSON.stringify(stored)).not.toContain(created.token.split('_')[2]);
    expect(stored.ttl).toBeGreaterThan(NOW / 1000);

    const list = await call('GET', '/api/tokens');
    expect(list.json.tokens).toEqual([expect.objectContaining({ id: created.id, name: 'Writer agent' })]);
    expect(list.json.tokens[0].token).toBeUndefined();
    expect(list.json.tokens[0].secretHash).toBeUndefined();

    expect((await call('DELETE', `/api/tokens/${created.id}`)).json).toEqual({ revoked: created.id });
    expect((await call('GET', '/api/tokens')).json.tokens).toEqual([]);
    expect((await call('DELETE', `/api/tokens/${created.id}`)).statusCode).toBe(404);
  });

  test('token requests are validated', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/tokens', { body: { name: '' } })).statusCode).toBe(400);
    expect((await call('POST', '/api/tokens', { body: { name: 'x'.repeat(61) } })).statusCode).toBe(400);
    expect((await call('POST', '/api/tokens', { body: { name: 'a', expiresInDays: 3 } })).statusCode).toBe(400);
    expect((await newToken(call, { name: 'Forever', expiresInDays: 0 })).expiresAt).toBe('');
    expect((await newToken(call)).expiresAt).toBe(new Date(NOW + 90 * 86400000).toISOString());
    expect((await call('POST', '/api/tokens', { body: { name: 'a' }, origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await call('GET', '/api/tokens', { signedIn: false })).statusCode).toBe(401);
  });

  test('at most 20 tokens', async () => {
    const { call } = setup();
    for (let i = 0; i < 20; i += 1) await newToken(call, { name: `Agent ${i}` });
    const res = await call('POST', '/api/tokens', { body: { name: 'One more' } });
    expect(res.statusCode).toBe(409);
  });

  test('an agent with a token writes, publishes and uploads without a cookie or Origin', async () => {
    const { call, files, store, tick } = setup();
    const { token, id: tokenId } = await newToken(call);
    const agent = asAgent(call, token);

    expect((await agent('GET', '/api/me')).json).toEqual({
      signedIn: true, user: 'user@example.com', name: 'Dewei', token: { id: tokenId, name: 'Writer agent', expiresAt: expect.any(String) },
    });
    const created = await agent('POST', '/api/posts', { body: { title: 'From the agent', body: 'Hello', status: 'published' } });
    expect(created.statusCode).toBe(201);
    expect(created.json).toMatchObject({ status: 'published', publishedAt: new Date(NOW).toISOString(), author: 'user@example.com', updatedVia: `API token "Writer agent" (${tokenId})` });
    expect(JSON.parse(files.objects.get('content/index.json').body).posts.map((p) => p.id)).toEqual([created.json.id]);

    tick();
    const updated = await agent('PUT', `/api/posts/${created.json.id}`, { body: { body: 'Hello again' } });
    expect(updated.json.body).toBe('Hello again');
    expect((await agent('GET', '/api/posts')).json.posts).toHaveLength(1);

    const start = await agent('POST', `/api/posts/${created.json.id}/files`, { body: { name: 'a.png', size: 3, type: 'image/png' } });
    expect(start.statusCode).toBe(201);
    files.put(start.json.uploadUrl.replace('/dev-files/', ''), 'png', 'image/png');
    const kept = await agent('PUT', `/api/posts/${created.json.id}/files/${start.json.fileId}`, { body: { name: 'a.png' } });
    expect(kept.statusCode).toBe(201);
    expect(kept.json.files).toHaveLength(1);
    expect((await agent('DELETE', `/api/posts/${created.json.id}/files/${start.json.fileId}`)).json.files).toEqual([]);

    expect(store.tokens.get(tokenId).lastUsedAt).toBe(new Date(NOW).toISOString());
    // Saving by the owner in the browser clears the token note.
    expect((await call('PUT', `/api/posts/${created.json.id}`, { body: { title: 'Edited' } })).json.updatedVia).toBeUndefined();
  });

  test('tokens cannot delete posts or manage tokens', async () => {
    const { call } = setup();
    const { token } = await newToken(call);
    const agent = asAgent(call, token);
    const post = await createPost(call, { title: 'Keep me' });
    const del = await agent('DELETE', `/api/posts/${post.id}`);
    expect(del.statusCode).toBe(403);
    expect(del.json.error).toMatch(/cannot delete/);
    expect((await call('GET', `/api/posts/${post.id}`)).statusCode).toBe(200);
    expect((await agent('GET', '/api/tokens')).statusCode).toBe(403);
    expect((await agent('POST', '/api/tokens', { body: { name: 'Another' } })).statusCode).toBe(403);
  });

  test('bad, revoked and expired tokens are refused, never falling back to the cookie', async () => {
    const { call, tick } = setup();
    const { token } = await newToken(call, { name: 'Short', expiresInDays: 7 });
    const wrong = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    for (const bad of [wrong, 'blog_123', 'nonsense']) {
      const res = await call('GET', '/api/posts', { token: bad });
      expect(res.statusCode).toBe(401);
      expect(res.json.error).toMatch(/API token/);
    }
    // CloudFront delivers the token in x-blog-token.
    expect((await call('GET', '/api/posts', { signedIn: false, headers: { 'x-blog-token': token } })).statusCode).toBe(200);
    const second = await newToken(call);
    await call('DELETE', `/api/tokens/${second.id}`);
    expect((await call('GET', '/api/me', { token: second.token, signedIn: false })).statusCode).toBe(401);

    tick(7 * 86400000 - 1000);
    expect((await call('GET', '/api/posts', { token, signedIn: false })).statusCode).toBe(200);
    tick(1000);
    expect((await call('GET', '/api/posts', { token, signedIn: false })).statusCode).toBe(401);
  });

  test('tokens work even when Microsoft sign-in is not configured', async () => {
    const store = createMemoryStore();
    const files = createMemoryFiles();
    const owner = createHandler({ store, files, loadConfig: async () => config, now: () => NOW });
    const session = auth.issueSession({ user: 'user@example.com', name: 'Dewei' }, config, NOW);
    const made = await owner({
      rawPath: '/api/tokens', headers: { origin: SITE_URL, 'content-type': 'application/json' }, cookies: [`${auth.SESSION_COOKIE}=${session}`],
      requestContext: { http: { method: 'POST' } }, body: JSON.stringify({ name: 'Agent' }),
    });
    const { token } = JSON.parse(made.body);
    const unconfigured = createHandler({ store, files, loadConfig: async () => { throw new NotConfigured('missing'); }, now: () => NOW });
    const res = await unconfigured({ rawPath: '/api/posts', headers: { authorization: `Bearer ${token}` }, requestContext: { http: { method: 'GET' } } });
    expect(res.statusCode).toBe(200);
  });
});

describe('post pages with link-preview tags', () => {
  const template = '<html><head><title>DL blog</title>\n<meta name="description" content="DL blog: posts by Dewei Liu">\n<!-- share -->\n<meta property="og:title" content="DL blog">\n<!-- /share -->\n</head><body><img class="share-image" src="/share.png" alt="" hidden></body></html>';

  function pageSetup() {
    const store = createMemoryStore();
    const files = createMemoryFiles();
    const handler = createHandler({ store, files, loadConfig: async () => config, loadTemplate: async () => template, now: () => NOW });
    const page = (id, method = 'GET') => handler({ rawPath: '/index.html', headers: id ? { 'x-blog-post': id } : {}, requestContext: { http: { method } } });
    return { ...setup(), store, files, handler, page };
  }

  test('a published post gets its own title, text and picture', async () => {
    const { store, page } = pageSetup();
    await store.putPost({
      id: '2026102701', status: 'published', title: 'Autumn <in> "Dublin"', excerpt: 'Leaves & rain.',
      cover: '/media/2026102701/abcdefghijklmnop/leaf.jpg', publishedAt: '2026-10-27T10:00:00.000Z', updatedAt: '2026-10-28T10:00:00.000Z',
    }, { create: true });
    const res = await page('2026102701');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=0, s-maxage=300');
    const image = 'https://blog.dliu.com/media/2026102701/abcdefghijklmnop/leaf.jpg';
    expect(res.body).toContain('<title>Autumn &#60;in&#62; &#34;Dublin&#34; · DL blog</title>');
    expect(res.body).toContain('<meta name="description" content="Leaves &#38; rain.">');
    expect(res.body).toContain('<meta property="og:title" content="Autumn &#60;in&#62; &#34;Dublin&#34;">');
    expect(res.body).toContain('<meta property="og:url" content="https://blog.dliu.com/2026102701">');
    expect(res.body).toContain(`<meta property="og:image" content="${image}">`);
    expect(res.body).toContain(`<img class="share-image" src="${image}" alt="" hidden>`);
    expect(res.body).not.toContain('og:title" content="DL blog"');
    expect((await page('2026102701', 'HEAD')).body).toBe('');
  });

  test('without a picture the site picture is used', async () => {
    const { store, page } = pageSetup();
    await store.putPost({ id: '2026102702', status: 'published', title: 'Notes', excerpt: '', cover: 'javascript:alert(1)' }, { create: true });
    const res = await page('2026102702');
    expect(res.body).toContain('<meta property="og:image" content="https://blog.dliu.com/share.png">');
    expect(res.body).toContain('<meta name="description" content="Notes · DL blog">');
  });

  test('drafts, unknown and bad IDs are 404 so CloudFront serves the plain page', async () => {
    const { store, page } = pageSetup();
    await store.putPost({ id: '2026102703', status: 'draft', title: 'Secret draft', excerpt: 'not yet' }, { create: true });
    for (const id of ['2026102703', '2026102799', '../index', '', '2026102703x']) {
      const res = await page(id);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('Secret');
    }
    expect((await page('2026102703', 'POST')).statusCode).toBe(405);
  });
});

describe('reactions', () => {
  const VISITOR = 'mgx2k1abcdefghij0123';
  const OTHER = 'mgx2k1zzzzzzzzzz9999';

  async function reactSetup() {
    process.env.ROOT_DOMAIN = 'dliu.com';
    const env = setup();
    const post = await createPost(env.call, { title: 'Hello', body: 'Hi', status: 'published' });
    const react = (reaction, { visitor = VISITOR, ip = '203.0.113.7', ...options } = {}) => env.call('POST', `/api/reactions/${post.id}`, {
      signedIn: false, body: { reaction }, headers: { ...(visitor ? { cookie: `dl_vid=${visitor}` } : {}), 'x-blog-viewer': ip }, ...options,
    });
    const read = (visitor = VISITOR) => env.call('GET', `/api/reactions/${post.id}`, { signedIn: false, origin: null, headers: visitor ? { cookie: `dl_vid=${visitor}` } : {} });
    return { ...env, post, react, read };
  }
  const counts = (like, love, haha, sad) => ({ like, love, haha, sad });

  test('a reader reacts once per post, switches and removes it, keyed by the dl_vid cookie', async () => {
    const { react, read, store, post } = await reactSetup();
    expect((await read()).json).toEqual({ counts: counts(0, 0, 0, 0), mine: null });

    let res = await react('love');
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ counts: counts(0, 1, 0, 0), mine: 'love' });
    expect(res.cookies).toBeUndefined();
    expect(store.reactions.get(post.id).visitors.get(VISITOR)).toBe('love');
    expect((await react('love')).json).toEqual({ counts: counts(0, 1, 0, 0), mine: 'love' });

    expect((await react('haha', { visitor: OTHER })).json).toEqual({ counts: counts(0, 1, 1, 0), mine: 'haha' });
    expect((await react('like')).json).toEqual({ counts: counts(1, 0, 1, 0), mine: 'like' });
    expect((await read()).json).toEqual({ counts: counts(1, 0, 1, 0), mine: 'like' });
    expect((await read(OTHER)).json.mine).toBe('haha');
    expect((await read('')).json.mine).toBeNull();

    res = await react(null);
    expect(res.json).toEqual({ counts: counts(0, 0, 1, 0), mine: null });
    expect((await react(null)).json.mine).toBeNull();
  });

  test('a browser without a valid dl_vid gets one, like the traffic monitor sets', async () => {
    const { react, read } = await reactSetup();
    for (const visitor of ['', 'BAD;value', 'short']) {
      const res = await react('sad', { visitor });
      expect(res.statusCode).toBe(200);
      expect(res.cookies).toHaveLength(1);
      const [, id] = /^dl_vid=([a-z0-9]{8,40}); Domain=\.dliu\.com; Path=\/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax$/.exec(res.cookies[0]) || [];
      expect(id).toBeDefined();
      expect((await read(id)).json.mine).toBe('sad');
    }
    expect((await read('')).json.counts.sad).toBe(3);
  });

  test('only same-site JSON with a known reaction, on published posts', async () => {
    const { react, call, post } = await reactSetup();
    expect((await react('like', { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await react('like', { origin: null })).statusCode).toBe(403);
    expect((await react('like', { contentType: 'text/plain' })).statusCode).toBe(415);
    for (const body of [{ reaction: 'angry' }, { reaction: 1 }, {}, ['like'], 'null']) {
      expect((await call('POST', `/api/reactions/${post.id}`, { signedIn: false, body })).statusCode).toBe(400);
    }
    const draft = await createPost(call, { title: 'Draft' });
    expect((await call('POST', `/api/reactions/${draft.id}`, { signedIn: false, body: { reaction: 'like' } })).statusCode).toBe(404);
    expect((await call('POST', '/api/reactions/2099010199', { signedIn: false, body: { reaction: 'like' } })).statusCode).toBe(404);
    expect((await call('GET', '/api/reactions/../posts', { signedIn: false })).statusCode).toBe(404);
    expect((await call('GET', `/api/reactions/${post.id}/x`, { signedIn: false })).statusCode).toBe(404);
    expect((await call('PUT', `/api/reactions/${post.id}`, { signedIn: false, body: { reaction: 'like' } })).statusCode).toBe(405);
  });

  test('at most 60 changes per IP address per hour', async () => {
    const { react, tick } = await reactSetup();
    for (let i = 0; i < 60; i += 1) expect((await react(i % 2 ? 'like' : null)).statusCode).toBe(200);
    const blocked = await react('love');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json.error).toMatch(/Too many reactions/);
    expect((await react('love', { ip: '198.51.100.1' })).statusCode).toBe(200);
    tick(3600 * 1000);
    expect((await react('haha')).statusCode).toBe(200);
  });

  test('deleting a post deletes its reactions', async () => {
    const { react, call, store, post } = await reactSetup();
    await react('love');
    expect((await call('DELETE', `/api/posts/${post.id}`)).statusCode).toBe(200);
    expect(store.reactions.has(post.id)).toBe(false);
  });
});
