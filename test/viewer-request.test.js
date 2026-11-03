'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../functions/viewer-request.js'), 'utf8'), context);
const run = (uri, headers = {}) => context.handler({ request: { uri, headers, querystring: {} } });

test('post pages are index.html with the post ID in x-blog-post', () => {
  const request = run('/2026102701', { 'x-blog-post': { value: '2026010100' } });
  expect(request.uri).toBe('/index.html');
  expect(request.headers['x-blog-post']).toEqual({ value: '2026102701' });
  expect(run('/2026102701/')).toMatchObject({ statusCode: 301, headers: { location: { value: '/2026102701' } } });
  // A viewer can't pick the post another page is rendered (and cached) for.
  for (const uri of ['/', '/index.html', '/admin', '/api/posts', '/20261027ab']) {
    expect(run(uri, { 'x-blog-post': { value: '2026102701' } }).headers['x-blog-post']).toBeUndefined();
  }
});

test('app pages are served by index.html', () => {
  for (const uri of ['/admin', '/admin/', '/admin/new', '/admin/posts/2026102700']) {
    expect(run(uri).uri).toBe('/index.html');
  }
});

test('/docs is served by docs.html', () => {
  expect(run('/docs').uri).toBe('/docs.html');
  expect(run('/docs/').uri).toBe('/docs.html');
  expect(run('/docs.js').uri).toBe('/docs.js');
});

test('/docs/api is the API guide; /docs/api.md is served as a file', () => {
  expect(run('/docs/api').uri).toBe('/docs-api.html');
  expect(run('/docs/api/').uri).toBe('/docs-api.html');
  expect(run('/docs/api.md').uri).toBe('/docs/api.md');
});

test('/docs/health redirects to the Testing tab, /docs#health; /docs/health.md is a file; /health is never redirected home', () => {
  for (const uri of ['/docs/health', '/docs/health/']) {
    expect(run(uri)).toMatchObject({ statusCode: 301, headers: { location: { value: '/docs#health' } } });
  }
  expect(run('/docs/health.md').uri).toBe('/docs/health.md');
  // /health has its own CloudFront behaviour; should the default one ever see it, it is not sent to the home page.
  expect(run('/health').uri).toBe('/health');
  expect(run('/health/')).toMatchObject({ statusCode: 301, headers: { location: { value: '/health' } } });
});

test('Authorization is no longer turned into a blog token header', () => {
  const bearer = { authorization: { value: 'Bearer synthetic' } };
  for (const uri of ['/api/posts', '/api/me', '/auth/login']) expect(run(uri, bearer).headers['x-blog-token']).toBeUndefined();
});

test("the viewer's IP replaces any x-blog-viewer on the API, for the reactions rate limit", () => {
  const forged = { 'x-blog-viewer': { value: '10.0.0.1' } };
  const request = context.handler({ request: { uri: '/api/reactions/2026102701', headers: { ...forged }, querystring: {} }, viewer: { ip: '203.0.113.7' } });
  expect(request.headers['x-blog-viewer']).toEqual({ value: '203.0.113.7' });
  expect(run('/api/reactions/2026102701', { ...forged }).headers['x-blog-viewer']).toBeUndefined();
});

test('files, the API and stored content pass through', () => {
  for (const uri of ['/', '/index.html', '/app.js', '/style.css', '/api/me', '/auth/login', '/content/index.json', '/media/a/b/c.jpg', '/favicon.ico']) {
    expect(run(uri).uri).toBe(uri);
  }
});

test('old WordPress links redirect', () => {
  const location = (uri) => {
    const res = run(uri);
    return [res.statusCode, res.headers && res.headers.location.value];
  };
  expect(location('/hello-world/')).toEqual([301, '/']);
  expect(location('/easter-trips-to-ireland')).toEqual([301, '/']);
  expect(location('/posts/2026102701')).toEqual([301, '/2026102701']);
  expect(location('/posts/hello-world')).toEqual([301, '/']);
  expect(location('/202610270')).toEqual([301, '/']);
  expect(location('/2025/04/')).toEqual([301, '/?m=202504']);
  expect(location('/page/2/')).toEqual([301, '/']);
  expect(location('/wp-admin/')).toEqual([302, '/admin']);
  expect(location('/wp-admin/post-new.php')).toEqual([302, '/admin']);
  expect(location('/wp-login.php')).toEqual([302, '/admin']);
  expect(run('/api').uri).toBe('/api');
});
