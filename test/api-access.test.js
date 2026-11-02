const auth = require('../lambda/api/auth');
const { authorize } = require('../lambda/api/api-access');
const { createHandler } = require('../lambda/api/index');
const { createMemoryFiles } = require('../scripts/memory-files');
const { createMemoryStore } = require('../scripts/memory-store');
const routes = require('../lambda/api/routes.json');

const NOW = Date.UTC(2026, 9, 31, 12);
const TENANT = '11111111-1111-4111-8111-111111111111';
const AUDIENCE = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const config = { tenantId: 'legacy', clientId: 'legacy', clientSecret: 'secret' };
const originalEnv = { ...process.env };

beforeEach(() => {
  Object.assign(process.env, { API_GATEWAY_ID: 'test-api', API_TENANT_ID: TENANT, API_AUDIENCE: AUDIENCE,
    API_CLIENT_ID: CLIENT, SITE_URL: 'https://blog.dliu.com', BLOG_BUCKET: 'test-bucket',
    AWS_REGION: 'eu-west-1', AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'secret' });
});
afterEach(() => { process.env = { ...originalEnv }; });

function event(method = 'GET', path = '/api/posts', scopes = ['blog.read'], routeKey = `${method} ${path}`) {
  return {
    rawPath: path,
    headers: {},
    requestContext: {
      apiId: 'test-api', routeKey, http: { method },
      authorizer: { jwt: { scopes, claims: { ver: '2.0', tid: TENANT, aud: AUDIENCE,
        iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, azp: CLIENT,
        oid: 'assigned-user', sub: 'subject', roles: ['api.access'], name: 'Test user' } } },
    },
  };
}

test('only the configured gateway and Microsoft v2 resource are trusted', () => {
  expect(authorize(event(), 'blog.read')).toEqual({ user: 'assigned-user', name: 'Test user' });
  for (const claim of ['ver', 'tid', 'aud', 'iss', 'oid', 'sub']) {
    const request = event();
    delete request.requestContext.authorizer.jwt.claims[claim];
    expect(authorize(request, 'blog.read').status).toBe(401);
  }
  const request = event();
  request.requestContext.apiId = 'other-api';
  expect(authorize(request, 'blog.read').status).toBe(401);
  delete request.requestContext.authorizer;
  expect(authorize(request, 'blog.read').status).toBe(401);
  delete request.requestContext;
  expect(authorize(request, 'blog.read').status).toBe(401);
});

test('client permission, user assignment and exact route scope are all required', () => {
  for (const change of [
    (jwt) => { jwt.claims.azp = 'other-client'; },
    (jwt) => { jwt.claims.roles = ['other.access']; },
    (jwt) => { jwt.claims.roles = ['blog.access']; },
    (jwt) => { jwt.claims.roles = '[blog.access]'; },
    (jwt) => { jwt.claims.roles = '[blog.access video.access files.access trip.access]'; },
    (jwt) => { jwt.claims.roles = '[api.access.admin]'; },
    (jwt) => { jwt.claims.roles = '[API.access]'; },
    (jwt) => { delete jwt.claims.roles; },
    (jwt) => { jwt.claims.roles = '["other,api.access"]'; },
    (jwt) => { jwt.claims.roles = '[broken'; },
    (jwt) => { jwt.claims.roles = '[]'; },
    (jwt) => { jwt.claims.roles = '[other.access]'; },
    (jwt) => { jwt.claims.roles = '[api.access.admin]'; },
    (jwt) => { jwt.claims.roles = '[xapi.access]'; },
    (jwt) => { jwt.claims.roles = '[other,api.access]'; },
    (jwt) => { jwt.claims.roles = '[other  api.access]'; },
    (jwt) => { jwt.claims.roles = '[other\tapi.access]'; },
    (jwt) => { jwt.claims.roles = '["api.access" other]'; },
    (jwt) => { jwt.claims.roles = '[api.access'; },
    (jwt) => { jwt.claims.roles = 'api.access]'; },
    (jwt) => { jwt.claims.roles = 'other api.access'; },
    (jwt) => { jwt.claims.roles = 'api.access.admin'; },
    (jwt) => { jwt.claims.roles = '{"0":"api.access"}'; },
    (jwt) => { jwt.claims.roles = '[1]'; },
    (jwt) => { jwt.claims.roles = [['api.access']]; },
    (jwt) => { jwt.claims.roles = { 0: 'api.access', length: 1 }; },
    (jwt) => { jwt.claims.roles = '[api.access]'; jwt.claims.azp = 'other-client'; },
    (jwt) => { jwt.claims.roles = '[api.access]'; jwt.scopes = ['blog.write']; },
    (jwt) => { jwt.scopes = ['blog.write']; },
    (jwt) => { jwt.scopes = 'blog.read'; },
  ]) {
    const request = event();
    change(request.requestContext.authorizer.jwt);
    expect(authorize(request, 'blog.read').status).toBe(403);
  }
  for (const roles of ['api.access', '["api.access"]', '[api.access]', '[other.access api.access]']) {
    const request = event();
    request.requestContext.authorizer.jwt.claims.roles = roles;
    expect(authorize(request, 'blog.read').user).toBe('assigned-user');
  }
  delete process.env.API_CLIENT_ID;
  expect(authorize(event(), 'blog.read').status).toBe(401);
});

test('roles arrive from API Gateway as a bracketed, space-separated string and are matched exactly', () => {
  const { parseRoles } = require('../lambda/api/api-access');
  expect(parseRoles('[api.access]')).toEqual(['api.access']);
  expect(parseRoles('[a.b api.access c-d]')).toEqual(['a.b', 'api.access', 'c-d']);
  expect(parseRoles('[]')).toEqual([]);
  expect(parseRoles(['api.access'])).toEqual(['api.access']);
  expect(parseRoles('["api.access"]')).toEqual(['api.access']);
  for (const bad of [undefined, null, 1, '', ' ', '[ api.access]', '[api.access ]', '[a  b]', '[a\nb]', '["a"', '[1]x', 'a b', '"api.access"', [1], {}]) {
    expect(parseRoles(bad)).toBeNull();
  }
  const request = event();
  request.requestContext.authorizer.jwt.claims.roles = '[api.access]';
  delete request.requestContext.authorizer.jwt.claims.ver;
  expect(authorize(request, 'blog.read').status).toBe(401);
});

test('a shared SPA client and resource ID still require exact gateway, audience, client, role and scope', () => {
  process.env.API_CLIENT_ID = AUDIENCE;
  const sharedEvent = () => {
    const request = event();
    request.requestContext.authorizer.jwt.claims.azp = AUDIENCE;
    return request;
  };
  expect(authorize(sharedEvent(), 'blog.read')).toEqual({ user: 'assigned-user', name: 'Test user' });
  for (const [change, status] of [
    [(request) => { request.requestContext.apiId = 'other-api'; }, 401],
    [(request) => { request.requestContext.authorizer.jwt.claims.aud = CLIENT; }, 401],
    [(request) => { request.requestContext.authorizer.jwt.claims.azp = CLIENT; }, 403],
    [(request) => { delete request.requestContext.authorizer.jwt.claims.roles; }, 403],
    [(request) => { delete request.requestContext.authorizer.jwt.claims.oid; }, 401],
    [(request) => { request.requestContext.authorizer.jwt.scopes = ['blog.write']; }, 403],
    [(request) => { request.requestContext.authorizer.jwt.scopes = ['.default']; }, 403],
  ]) {
    const request = sharedEvent();
    change(request);
    expect(authorize(request, 'blog.read').status).toBe(status);
  }
  expect(authorize(sharedEvent(), 'blog.delete').status).toBe(403);
});

const POST = '2026103100';
const FILE = 'Ab3dEf6hIj9kLm0n';

// A managed request as API Gateway delivers it: the routeKey is the template, rawPath the concrete path.
function managed(method, path, scopes, body) {
  const template = path.replace(/^\/api\/posts\/\d{10}/, '/api/posts/{postId}').replace(/\/files\/[A-Za-z0-9_-]{16}$/, '/files/{fileId}');
  const request = event(method, path, scopes, `${method} ${template}`);
  if (body !== undefined) {
    request.headers['content-type'] = 'application/json';
    request.body = JSON.stringify(body);
  }
  return request;
}

function blogSetup() {
  const store = createMemoryStore();
  const files = createMemoryFiles();
  const loadConfig = jest.fn(async () => { throw new Error('Must not load browser sign-in settings'); });
  const handler = createHandler({ store, files, loadConfig, now: () => NOW });
  const call = async (...args) => {
    const response = await handler(managed(...args));
    return { ...response, json: JSON.parse(response.body) };
  };
  return { store, files, loadConfig, handler, call };
}

describe('managed Blog API', () => {
  test('nine routes, each with exactly one blog scope; write never includes delete', () => {
    expect(routes).toEqual({
      'GET /api/me': { scope: 'blog.read' },
      'GET /api/posts': { scope: 'blog.read' },
      'GET /api/posts/{postId}': { scope: 'blog.read' },
      'POST /api/posts': { scope: 'blog.write' },
      'PUT /api/posts/{postId}': { scope: 'blog.write' },
      'POST /api/posts/{postId}/files': { scope: 'blog.write' },
      'PUT /api/posts/{postId}/files/{fileId}': { scope: 'blog.write' },
      'DELETE /api/posts/{postId}': { scope: 'blog.delete' },
      'DELETE /api/posts/{postId}/files/{fileId}': { scope: 'blog.delete' },
    });
  });

  test('an assigned user writes, uploads, publishes and deletes without cookies, Origin or browser settings', async () => {
    const { call, files, store, loadConfig } = blogSetup();
    expect((await call('GET', '/api/me', ['blog.read'])).json).toEqual({ signedIn: true, user: 'assigned-user', name: 'Test user' });
    const created = await call('POST', '/api/posts', ['blog.write'], { title: 'From an agent', body: 'Hello' });
    expect(created.statusCode).toBe(201);
    expect(created.json).toMatchObject({ id: POST, status: 'draft', author: 'assigned-user', authorName: 'Test user', updatedVia: 'Microsoft API' });

    const start = await call('POST', `/api/posts/${POST}/files`, ['blog.write'], { name: 'photo.jpg', size: 4, type: 'image/jpeg' });
    expect(start.statusCode).toBe(201);
    files.put(start.json.uploadUrl.replace('/dev-files/', ''), 'jpeg', 'image/jpeg');
    const attached = await call('PUT', `/api/posts/${POST}/files/${start.json.fileId}`, ['blog.write'], { name: 'photo.jpg' });
    expect(attached.statusCode).toBe(201);
    expect(attached.json.files[0]).toMatchObject({ id: start.json.fileId, name: 'photo.jpg' });

    const published = await call('PUT', `/api/posts/${POST}`, ['blog.write'], { status: 'published' });
    expect(published.json).toMatchObject({ status: 'published', publishedAt: new Date(NOW).toISOString() });
    expect(files.json(`posts/${POST}.json`)).toMatchObject({ id: POST });
    expect((await call('GET', '/api/posts', ['blog.read'])).json.posts).toEqual([expect.objectContaining({ id: POST })]);
    expect((await call('GET', `/api/posts/${POST}`, ['blog.read'])).json.body).toBe('Hello');

    expect((await call('DELETE', `/api/posts/${POST}/files/${start.json.fileId}`, ['blog.delete'])).json.files).toEqual([]);
    expect((await call('DELETE', `/api/posts/${POST}`, ['blog.delete'])).json).toEqual({ deleted: POST });
    expect(await store.getPost(POST)).toBeFalsy();
    expect(loadConfig).not.toHaveBeenCalled();
  });

  test('each route needs its own scope: read cannot write, write cannot delete, delete cannot read', async () => {
    const { call, store } = blogSetup();
    await call('POST', '/api/posts', ['blog.write'], { title: 'Keep me' });
    for (const [method, path, scopes, body] of [
      ['GET', '/api/me', ['blog.write', 'blog.delete']],
      ['GET', '/api/posts', ['blog.write']],
      ['GET', `/api/posts/${POST}`, ['blog.delete']],
      ['POST', '/api/posts', ['blog.read', 'blog.delete'], { title: 'x' }],
      ['PUT', `/api/posts/${POST}`, ['blog.read'], { status: 'published' }],
      ['POST', `/api/posts/${POST}/files`, ['blog.read'], { name: 'a.jpg', size: 1, type: 'image/jpeg' }],
      ['PUT', `/api/posts/${POST}/files/${FILE}`, ['blog.delete'], { name: 'a.jpg' }],
      ['DELETE', `/api/posts/${POST}`, ['blog.read', 'blog.write']],
      ['DELETE', `/api/posts/${POST}/files/${FILE}`, ['blog.write']],
      ['DELETE', `/api/posts/${POST}`, ['video.delete', 'files.delete', 'trip.delete']],
    ]) {
      const response = await call(method, path, scopes, body);
      expect([method, path, response.statusCode, response.json]).toEqual([method, path, 403, { error: 'Blog API permission required' }]);
    }
    expect((await store.getPost(POST)).status).toBe('draft');
  });

  test('another site role, client, tenant or gateway is refused', async () => {
    const { handler } = blogSetup();
    for (const [change, status] of [
      [(request) => { request.requestContext.authorizer.jwt.claims.roles = '[blog.access]'; }, 403],
      [(request) => { request.requestContext.authorizer.jwt.claims.roles = '[video.access files.access trip.access]'; }, 403],
      [(request) => { request.requestContext.authorizer.jwt.claims.azp = 'other-client'; }, 403],
      [(request) => { request.requestContext.authorizer.jwt.claims.tid = 'other-tenant'; }, 401],
      [(request) => { request.requestContext.apiId = 'video-api'; }, 401],
      [() => { delete process.env.API_GATEWAY_ID; }, 401],
    ]) {
      const request = managed('GET', '/api/posts', ['blog.read']);
      change(request);
      expect((await handler(request)).statusCode).toBe(status);
      process.env.API_GATEWAY_ID = 'test-api';
    }
  });

  test('a cookie is never a fallback and the Authorization header is never read', async () => {
    const { handler, loadConfig } = blogSetup();
    const session = auth.issueSession({ user: 'owner@example.com', name: 'Owner' }, config, NOW);
    let headerReads = 0;
    const request = managed('POST', '/api/posts', [], { title: 'x' });
    request.cookies = [`${auth.SESSION_COOKIE}=${session}`];
    request.headers.origin = 'https://blog.dliu.com';
    Object.defineProperty(request.headers, 'authorization', { enumerable: true, get() { headerReads += 1; return 'synthetic-marker'; } });
    const denied = await handler(request);
    expect(denied.statusCode).toBe(403);
    expect(denied.cookies).toBeUndefined();
    expect(denied.body).not.toContain('synthetic-marker');
    delete request.requestContext.authorizer;
    expect((await handler(request)).statusCode).toBe(401);
    expect(headerReads).toBe(0);
    expect(loadConfig).not.toHaveBeenCalled();
  });

  test('only listed routes, with a matching method and path, are served', async () => {
    const { handler } = blogSetup();
    const all = ['blog.read', 'blog.write', 'blog.delete'];
    for (const [routeKey, method, path] of [
      ['POST /api/reactions/{postId}', 'POST', `/api/reactions/${POST}`],
      ['GET /api/tokens', 'GET', '/api/tokens'],
      ['POST /api/tokens', 'POST', '/api/tokens'],
      ['GET /auth/login', 'GET', '/auth/login'],
      ['GET /index.html', 'GET', '/index.html'],
      ['ANY /{proxy+}', 'GET', '/api/posts'],
      ['toString', 'GET', '/api/me'],
      ['GET /api/me', 'DELETE', `/api/posts/${POST}`],
      ['GET /api/posts/{postId}', 'GET', `/api/posts/${POST}/files`],
      ['GET /api/posts/{postId}/reactions', 'GET', `/api/posts/${POST}/reactions`],
      ['GET /api/posts/{postId}', 'GET', `/api/posts/${POST}/reactions`],
      ['GET /api/posts/{postId}', 'GET', '/api/posts/'],
      ['GET /api/posts', 'GET', '/api/me'],
      ['DELETE /api/posts/{postId}/files/{fileId}', 'DELETE', `/api/posts/${POST}`],
    ]) {
      const response = await handler(event(method, path, all, routeKey));
      expect([routeKey, method, path, response.statusCode]).toEqual([routeKey, method, path, 404]);
    }
  });

  test('a function URL event ($default) stays on cookie sign-in and ignores bearer headers', async () => {
    const store = createMemoryStore();
    const handler = createHandler({ store, files: createMemoryFiles(), loadConfig: async () => config, now: () => NOW });
    const request = { rawPath: '/api/posts', headers: { authorization: 'Bearer synthetic', 'x-blog-token': 'blog_000000000000_' + '0'.repeat(64) },
      requestContext: { apiId: 'function-url', routeKey: '$default', http: { method: 'GET' } } };
    expect((await handler(request)).statusCode).toBe(401);
    expect(JSON.parse((await handler({ ...request, rawPath: '/api/me' })).body)).toEqual({ signedIn: false });
  });
});
