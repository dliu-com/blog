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

  function call(method, path, { body, signedIn = true, origin = SITE_URL, contentType = 'application/json', headers: extra = {} } = {}) {
    const headers = { ...extra };
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
  function withCookie(handler, value, method = 'GET', path = '/api/posts') {
    return handler({
      rawPath: path,
      headers: { origin: SITE_URL, 'content-type': 'application/json' },
      cookies: [`${auth.SESSION_COOKIE}=${value}`],
      requestContext: { http: { method } },
      body: method === 'GET' ? undefined : '{"title":"x"}',
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

  test('the sign-in error page shows only an OAuth error code, never other text from the link', async () => {
    const { call } = setup();
    const denied = await call('GET', '/auth/callback?error=access_denied', { signedIn: false });
    expect(denied.statusCode).toBe(401);
    expect(denied.body).toContain('Sign-in failed: access_denied');
    const spoof = await call('GET', `/auth/callback?error=${encodeURIComponent('<b>Call +1 555 0100 to unlock</b>')}`, { signedIn: false });
    expect(spoof.statusCode).toBe(401);
    expect(spoof.body).toContain('Sign-in failed: unknown_error');
    expect(spoof.body).not.toMatch(/555|unlock|<b>/);
  });
});

describe('retired blog API tokens', () => {
  test('the website API has no token routes and ignores bearer and x-blog-token headers', async () => {
    const { call, store } = setup();
    expect((await call('GET', '/api/tokens')).statusCode).toBe(404);
    expect((await call('POST', '/api/tokens', { body: { name: 'Agent' } })).statusCode).toBe(404);
    expect((await call('DELETE', '/api/tokens/0123456789ab')).statusCode).toBe(404);
    const oldToken = `blog_0123456789ab_${'a'.repeat(64)}`;
    for (const headers of [{ authorization: `Bearer ${oldToken}` }, { 'x-blog-token': oldToken }]) {
      expect((await call('GET', '/api/posts', { signedIn: false, origin: null, headers })).statusCode).toBe(401);
      expect((await call('POST', '/api/posts', { signedIn: false, origin: null, headers, body: { title: 'x' } })).statusCode).toBe(401);
      expect((await call('GET', '/api/me', { signedIn: false, headers })).json).toEqual({ signedIn: false });
    }
    expect(await store.listPosts()).toEqual([]);
  });

  test('a signed-in owner still writes from the site, and edits are no longer marked as API edits', async () => {
    const { call } = setup();
    const post = await createPost(call, { title: 'From the browser' });
    expect(post.author).toBe('user@example.com');
    expect(post.updatedVia).toBeUndefined();
    expect((await call('PUT', `/api/posts/${post.id}`, { body: { title: 'x' }, origin: null })).statusCode).toBe(403);
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

  test('the preview text is short: cut at a sentence end that fits, else at a space with an ellipsis', () => {
    const { shareDescription } = require('../lambda/api/page');
    expect(shareDescription('Short.')).toBe('Short.');
    const zh = '小黄和小花是Hujia养的两只荷兰猪，也叫豚鼠——一种小型食草宠物，并不是猪。我们平时亲切地叫它们“猪猪”。 它们都出生于2021年，分别于2026年10月24日、30日离世。10月31日，我们几位朋友在北爱尔兰贝尔法斯特附近的Divis山间，给它们办了一场小小的告别礼。';
    expect(shareDescription(zh)).toBe('小黄和小花是Hujia养的两只荷兰猪，也叫豚鼠——一种小型食草宠物，并不是猪。我们平时亲切地叫它们“猪猪”。 它们都出生于2021年，分别于2026年10月24日、30日离世。');
    const en = `${'word '.repeat(40)}end`;
    expect(shareDescription(en)).toMatch(/^(word ){0,23}word…$/);
    expect([...shareDescription(en)].length).toBeLessThanOrEqual(120);
    expect([...shareDescription('字'.repeat(300))]).toHaveLength(120);
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

  test('only the signed-in author sees who reacted, newest first, with links to their visitor IDs', async () => {
    const { react, read, call, tick, post } = await reactSetup();
    const who = (options) => call('GET', `/api/posts/${post.id}/reactions`, { origin: null, ...options });
    expect((await who()).json).toEqual({ reactions: [] });
    await react('love');
    tick();
    await react('haha', { visitor: OTHER, ip: '198.51.100.1' });

    const res = await who({ headers: { cookie: `dl_vid=${VISITOR}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.json).toEqual({ reactions: [
      { visitor: OTHER, reaction: 'haha', updatedAt: new Date(NOW + 60000).toISOString(), you: false },
      { visitor: VISITOR, reaction: 'love', updatedAt: new Date(NOW).toISOString(), you: true },
    ] });

    // Guests and readers get counts and their own reaction only.
    for (const headers of [{}, { cookie: `dl_vid=${VISITOR}` }]) {
      const guest = await who({ signedIn: false, headers });
      expect(guest.statusCode).toBe(401);
      expect(guest.body).not.toContain(OTHER);
    }
    expect(Object.keys((await read()).json).sort()).toEqual(['counts', 'mine']);
    expect(JSON.stringify((await read()).json)).not.toContain(OTHER);

    expect((await call('POST', `/api/posts/${post.id}/reactions`, { body: {} })).statusCode).toBe(405);
    expect((await call('GET', `/api/posts/${post.id}/reactions/x`)).statusCode).toBe(404);
    expect((await call('GET', '/api/posts/2099010199/reactions')).statusCode).toBe(404);
    expect((await call('GET', `/api/posts/${post.id}/other`)).statusCode).toBe(404);
  });

  test('deleting a post deletes its reactions', async () => {
    const { react, call, store, post } = await reactSetup();
    await react('love');
    expect((await call('DELETE', `/api/posts/${post.id}`)).statusCode).toBe(200);
    expect(store.reactions.has(post.id)).toBe(false);
  });
});
