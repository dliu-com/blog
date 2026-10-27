'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../functions/viewer-request.js'), 'utf8'), context);
const run = (uri) => context.handler({ request: { uri, headers: {}, querystring: {} } });

test('app pages are served by index.html', () => {
  for (const uri of ['/admin', '/admin/', '/admin/new', '/admin/posts/abcdefghijkl', '/posts/hello-world', '/posts/万圣节']) {
    expect(run(uri).uri).toBe('/index.html');
  }
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
  expect(location('/hello-world/')).toEqual([301, '/posts/hello-world']);
  expect(location('/easter-trips-to-ireland')).toEqual([301, '/posts/easter-trips-to-ireland']);
  expect(location('/2025/04/')).toEqual([301, '/?m=202504']);
  expect(location('/page/2/')).toEqual([301, '/?paged=2']);
  expect(location('/wp-admin/')).toEqual([302, '/admin']);
  expect(location('/wp-admin/post-new.php')).toEqual([302, '/admin']);
  expect(location('/wp-login.php')).toEqual([302, '/admin']);
  expect(run('/api').uri).toBe('/api');
});
