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
  const session = auth.sign({ user: 'user@example.com', name: 'Dewei', exp: NOW / 1000 + 86400 }, auth.sessionKey(config));

  function call(method, path, { body, signedIn = true, origin = SITE_URL, contentType = 'application/json' } = {}) {
    const headers = {};
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
