'use strict';

const fs = require('node:fs');
const path = require('node:path');
const routes = require('../lambda/api/routes.json');

const WEB = path.join(__dirname, '..', 'web');
const guide = fs.readFileSync(path.join(WEB, 'docs', 'api.md'), 'utf8');

test('the API guide lists every managed route with its scope and links the Auth reference', () => {
  const rows = [...guide.matchAll(/^- `(GET|POST|PUT|DELETE) ([^`]+)`, scope `(blog\.\w+)`: \S/gm)]
    .map(([, method, route, scope]) => [`${method} ${route.replace('<id>', '{postId}').replace('<fileId>', '{fileId}')}`, scope]);
  expect(Object.fromEntries(rows)).toEqual(Object.fromEntries(Object.entries(routes).map(([key, value]) => [key, value.scope])));
  expect(rows).toHaveLength(9);
  expect(guide).not.toMatch(/^\|/m);
  expect(guide).toContain('[Auth API documentation](https://auth.dliu.com/docs/api)');
  expect(guide).toContain('`api.access`');
});

test('the API origin is filled in at deploy time, never hard-coded', () => {
  expect(guide.split('{{MICROSOFT_API_URL}}')).toHaveLength(3);
  expect(guide).not.toMatch(/execute-api\.[a-z0-9-]+\.amazonaws\.com/);
});

test('no retired blog token instructions remain in the site', () => {
  const files = ['docs/api.md', 'docs-api.html', 'docs.html', 'index.html', 'app.js', 'docs.js', 'docs-api.js', 'i18n.js'];
  for (const file of files) {
    const text = fs.readFileSync(path.join(WEB, file), 'utf8');
    for (const retired of ['/api/tokens', 'x-blog-token', 'dliu_credentials', 'blog_0123', 'Generate token', 'Copy command']) {
      expect([file, text.includes(retired)]).toEqual([file, false]);
    }
  }
});

test('every header shows a Docs button linking to /docs, on phones too', () => {
  for (const file of ['app.js', 'docs-nav.js']) {
    const text = fs.readFileSync(path.join(WEB, file), 'utf8');
    expect([file, text.includes("a.href = '/docs';")]).toEqual([file, true]);
    expect([file, text.includes('hide-narrow')]).toEqual([file, false]);
  }
  const css = fs.readFileSync(path.join(WEB, 'style.css'), 'utf8');
  expect(css).toContain('.dl-nav .icon-narrow .label { display: none; }');
  expect(css).not.toMatch(/docs-link[^{]*\{[^}]*display:\s*none/);
});

test('only signed-in authors get the who-reacted list, linked to the traffic monitor', () => {
  const app = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  expect(app).toContain('reactionBar(post.id, { signedIn: Boolean(me && me.signedIn) })');
  expect(app).toContain('const who = signedIn ? whoReacted(postId) : null;');
  expect(app).toContain('https://traffic.dliu.com/visitor?visitor=${encodeURIComponent(id)}');
  expect(app).toContain("rel: 'noopener noreferrer'");
});

test('every page loads the traffic monitor\'s page script with one plain async tag', () => {
  for (const file of ['index.html', 'docs.html', 'docs-api.html']) {
    const text = fs.readFileSync(path.join(WEB, file), 'utf8');
    expect([file, text.split('traffic.dliu.com').length - 1]).toEqual([file, 1]);
    expect([file, text.includes('<script src="https://traffic.dliu.com/t/s.js" async></script>')]).toEqual([file, true]);
  }
  for (const file of ['app.js', 'docs-nav.js']) {
    expect([file, fs.readFileSync(path.join(WEB, file), 'utf8').includes('t/s.js')]).toEqual([file, false]);
  }
  expect(fs.readFileSync(path.join(WEB, 'docs.js'), 'utf8')).toContain("from './docs-nav.js'");
  expect(fs.readFileSync(path.join(WEB, 'docs-api.js'), 'utf8')).toContain("from './docs-nav.js'");
});

test('the Security tab lists the live penetration test before the threat model, with expected and actual results', () => {
  const docs = fs.readFileSync(path.join(WEB, 'docs.js'), 'utf8');
  const pentest = docs.indexOf("t('线上渗透测试', 'Live penetration test')");
  expect(pentest).toBeGreaterThan(docs.indexOf('function security('));
  expect(pentest).toBeLessThan(docs.indexOf("t('威胁模型', 'Threat model')"));
  expect(docs).toContain("t('预期结果', 'Expected'), t('实际结果', 'Actual result')");
  expect(docs).toMatch(/className: 'status'/);
});

test('the Security tab has a STRIDE threat model, denial of wallet and a code review with findings', () => {
  const docs = fs.readFileSync(path.join(WEB, 'docs.js'), 'utf8');
  const order = ["t('威胁模型', 'Threat model')", "t('资产', 'Assets')", "t('攻击者', 'Actors')", "t('信任边界和数据流', 'Trust boundaries and data flows')",
    "t('按组件的 STRIDE', 'STRIDE by component')", "t('拒绝钱包：被刷流量时最多花多少钱', 'Denial of wallet: the most a flood can cost')",
    "t('代码审查', 'Code review')", "t('接受的剩余风险', 'Accepted residual risks')"].map((text) => docs.indexOf(text));
  expect(order.every((index) => index > docs.indexOf('function security('))).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  for (const letter of ["'Spoofing'", "'Tampering'", "'Repudiation'", "'Information disclosure'", "'Denial of service'", "'Elevation of privilege'"]) expect(docs).toContain(letter);
  for (const id of ['F1', 'F2', 'F3', 'F4']) expect(docs).toContain(`['${id}', `);
  expect(docs).toContain('scripts/pentest.mjs');
});
