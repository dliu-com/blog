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

// The API tab (/docs#api) is for people: flows, numbers, tables and a chart, with which endpoints exist and what
// each is for, but no exact request or response formats; /docs/api.md is the full reference for machines.
test('the API tab lists the same nine endpoints and permissions as the guide, without exact formats', () => {
  const html = fs.readFileSync(path.join(WEB, 'docs.html'), 'utf8');
  const start = html.indexOf('<article id="api"');
  const tab = html.slice(start, html.indexOf('</article>', start));
  expect(start).toBeGreaterThan(0);
  expect(html).toContain('<a href="#api" data-tab="api">API</a>');
  expect(fs.readFileSync(path.join(WEB, 'docs.js'), 'utf8')).toContain("api: staticTab");
  const words = { 'blog.read': ['读', 'Read'], 'blog.write': ['写', 'Write'], 'blog.delete': ['删除', 'Delete'] };
  const rows = [...tab.matchAll(/<tr data-route="([^"]+)"><td class="mono">[^<]+<\/td><td data-zh="[^"]+">[^<]+<\/td><td data-zh="([^"]+)">([^<]+)<\/td><\/tr>/g)]
    .map(([, route, zh, en]) => [route, [zh, en]]);
  expect(Object.fromEntries(rows)).toEqual(Object.fromEntries(Object.entries(routes).map(([key, { scope }]) => [key, words[scope]])));
  // The chart: endpoints per permission, matching routes.json.
  for (const scope of Object.keys(words)) {
    const count = Object.values(routes).filter((route) => route.scope === scope).length;
    const bar = tab.match(new RegExp(`<li data-scope="${scope.replace('.', '\\.')}">([\\s\\S]*?)</li>`))[1];
    expect([scope, bar.match(/class="bar-unit/g).length, bar.match(/<span class="bar-value">(\d+)</)[1]]).toEqual([scope, count, String(count)]);
  }
  expect(tab).toMatch(/class="dg-flow"/);
  expect(tab.match(/class="dg-stat"/g).length).toBeGreaterThanOrEqual(4);
  expect(tab).not.toMatch(/<code|<pre|<details|\{"|Content-Type|application\/|\b(201|401|403|404|409|413|415)\b/);
  expect(tab).toContain('<a href="/docs/api.md" data-zh="面向机器的技术版本（Markdown）">Technical version for machines (Markdown)</a>');
  expect(html).toContain('<link rel="alternate" type="text/markdown" href="/docs/api.md"');
  expect(fs.existsSync(path.join(WEB, 'docs-api.html'))).toBe(false);
  expect(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8')).toContain("href: '/docs#api', text: 'API'");
});

// The API and Health tabs draw their components like the Architecture tab: tiers of cards joined by labelled
// arrows, with the same icon (and so colour) for the same service.
test('the API and Health tabs have tier diagrams in the Architecture style, with matching icons', () => {
  const html = fs.readFileSync(path.join(WEB, 'docs.html'), 'utf8');
  const docsJs = fs.readFileSync(path.join(WEB, 'docs.js'), 'utf8');
  const arch = docsJs.slice(docsJs.indexOf("title: t('组件', 'Components')"), docsJs.indexOf("add('h2', t('阅读博客'"));
  const archIcons = new Map([...arch.matchAll(/\{ icon: '(\w+)', title: t\('[^']+', '([^']+)'\)/g)].map(([, icon, title]) => [title, icon]));
  expect(archIcons.size).toBeGreaterThanOrEqual(10);
  expect(docsJs).toContain("'.dg-step[data-icon], .dg-stat[data-icon], .dg-node[data-icon]'");
  for (const id of ['api', 'health']) {
    const start = html.indexOf(`<article id="${id}"`);
    const tab = html.slice(start, html.indexOf('</article>', start));
    const figure = tab.match(/<figure class="dg dg-tiers [\w-]+">([\s\S]*?)<\/figure>/)[1];
    expect([id, [...figure.matchAll(/<div class="dg-tier dg-(\w+)">/g)].map(([, tone]) => tone)]).toEqual([id, ['untrusted', 'edge', 'app', 'private']]);
    expect(figure.match(/<div class="dg-tier-label"><span class="dg-badge"[^>]*>[^<]+<\/span><strong[^>]*>[^<]+<\/strong><\/div>/g)).toHaveLength(4);
    expect(figure.match(/<div class="dg-link"><span class="dg-arrow"><svg [^>]+><path [^>]+\/><\/svg><\/span><span data-zh="[^"]+">[^<]+<\/span><\/div>/g)).toHaveLength(3);
    const nodes = [...figure.matchAll(/<div class="dg-node" data-icon="(\w+)"><span class="dg-text"><strong[^>]*>([^<]+)<\/strong><small data-zh="[^"]+">[^<]+<\/small><\/span><\/div>/g)];
    expect(nodes.length).toBe(figure.match(/class="dg-node"/g).length);
    expect(nodes.length).toBeGreaterThanOrEqual(5);
    const shared = nodes.filter(([, , title]) => archIcons.has(title));
    expect(shared.length).toBeGreaterThanOrEqual(4);
    for (const [, icon, title] of shared) expect([id, title, icon]).toEqual([id, title, archIcons.get(title)]);
    expect(tab.match(/class="dg-stat" data-icon="\w+"/g).length).toBeGreaterThanOrEqual(4);
  }
  expect(html).toMatch(/<article id="api"[^>]*>\s*<h2 [^>]*>[^<]+<\/h2>\s*<p class="agent-note machine-link"><span data-zh="机器可读版本：">Machine-readable version: <\/span><a href="\/docs\/api\.md">\/docs\/api\.md<\/a><\/p>/);
});

test('the Architecture tab starts with a link to the source code on GitHub (shared dl-docs-repo)', () => {
  const html = fs.readFileSync(path.join(WEB, 'docs.html'), 'utf8');
  const article = html.match(/<article id="architecture" class="dl-docs">\s*([\s\S]*?)<\/article>/)[1];
  expect(article.startsWith('<p class="dl-docs-repo"><span data-zh="源代码：">Source code:</span> <a href="https://github.com/dliu-com/blog">github.com/dliu-com/blog</a></p>')).toBe(true);
  expect(html).toContain('https://files.dliu.com/dliu.com/ui/v1/dl-docs.css');
});

test('the first tab is called Architecture, with its #architecture anchor kept', () => {
  const html = fs.readFileSync(path.join(WEB, 'docs.html'), 'utf8');
  expect(html).toContain('<a href="#architecture" data-tab="architecture" data-zh="架构">Architecture</a>');
  expect(fs.readFileSync(path.join(WEB, 'docs.js'), 'utf8')).toContain("architecture: () => t('架构', 'Architecture'),");
  expect(html + fs.readFileSync(path.join(WEB, 'docs.js'), 'utf8')).not.toContain('Technical architecture');
});

test('the API origin is filled in at deploy time, never hard-coded', () => {
  expect(guide.split('{{MICROSOFT_API_URL}}')).toHaveLength(3);
  expect(guide).not.toMatch(/execute-api\.[a-z0-9-]+\.amazonaws\.com/);
});

test('no retired blog token instructions remain in the site', () => {
  const files = ['docs/api.md', 'docs/health.md', 'docs.html', 'index.html', 'app.js', 'docs.js', 'i18n.js'];
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
  for (const file of ['index.html', 'docs.html']) {
    const text = fs.readFileSync(path.join(WEB, file), 'utf8');
    expect([file, text.split('traffic.dliu.com').length - 1]).toEqual([file, 1]);
    expect([file, text.includes('<script src="https://traffic.dliu.com/t/s.js" async></script>')]).toEqual([file, true]);
  }
  for (const file of ['app.js', 'docs-nav.js']) {
    expect([file, fs.readFileSync(path.join(WEB, file), 'utf8').includes('t/s.js')]).toEqual([file, false]);
  }
  expect(fs.readFileSync(path.join(WEB, 'docs.js'), 'utf8')).toContain("from './docs-nav.js'");
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
