'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../functions/viewer-request.js'), 'utf8'), context);
const run = (uri) => context.handler({ request: { uri, headers: {}, querystring: {} } });

test('app pages are served by index.html', () => {
  for (const uri of ['/2026102701', '/2026102700/', '/admin', '/admin/', '/admin/new', '/admin/posts/2026102700']) {
    expect(run(uri).uri).toBe('/index.html');
  }
});

test('/docs is served by docs.html', () => {
  expect(run('/docs').uri).toBe('/docs.html');
  expect(run('/docs/').uri).toBe('/docs.html');
  expect(run('/docs.js').uri).toBe('/docs.js');
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
