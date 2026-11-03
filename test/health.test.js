'use strict';

// The dliu.com health contract (status.dliu.com): GET /health, the Testing tab /docs#health (people) and
// /docs/health.md (machines).
const fs = require('node:fs');
const path = require('node:path');
const { createHandler } = require('../lambda/api/index');
const health = require('../lambda/api/health');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const docsHtml = read('web/docs.html');
// The Testing tab: <article id="health"> in docs.html.
const page = docsHtml.slice(docsHtml.indexOf('<article id="health"'), docsHtml.indexOf('</article>', docsHtml.indexOf('<article id="health"')) + '</article>'.length);
const markdown = read('web/docs/health.md');
const KEYS = health.FUNCTIONS.map((f) => f.key);

// A request whose cookies, headers and query string throw if anything reads them.
const untouchable = (what) => new Proxy({}, { get(target, name) { throw new Error(`read ${what}.${String(name)}`); } });
const healthEvent = (method = 'GET') => ({
  rawPath: '/health',
  requestContext: { http: { method } },
  headers: untouchable('headers'),
  cookies: untouchable('cookies'),
  queryStringParameters: untouchable('query'),
});
const passing = () => Object.fromEntries(KEYS.map((key) => [key, jest.fn(async () => {})]));
const handlerWith = (healthChecks) => createHandler({
  healthChecks,
  store: {},
  files: {},
  loadConfig: async () => { throw new Error('the handler must not load config itself'); },
});

// The section of the Markdown file under "## <title>", up to the next "## ".
const section = (title) => markdown.split(/^## /m).find((part) => part.startsWith(`${title}\n`)) || '';
const tableRows = (text) => text.split('\n').filter((line) => /^\| `/.test(line)).map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
const unquote = (cell) => cell.replace(/^`|`$/g, '');

describe('GET /health', () => {
  test('answers application/health+json, cached 60 s, with every function passing', async () => {
    const checks = passing();
    const response = await handlerWith(checks)(healthEvent());
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({ 'content-type': 'application/health+json', 'cache-control': 'public, max-age=60' });
    expect(response.cookies).toBeUndefined();
    const body = JSON.parse(response.body);
    expect(body.status).toBe('pass');
    expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(body.functions).toEqual(health.FUNCTIONS.map((f) => ({ ...f, status: 'pass' })));
    for (const key of KEYS) expect(checks[key]).toHaveBeenCalledWith();
  });

  test('reads no cookies, no headers (so no Authorization) and no query string', async () => {
    const response = await handlerWith(passing())(healthEvent());
    expect(response.statusCode).toBe(200);
    const source = read('lambda/api/health.js').replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/event|cookie|authorization|queryString/i);
  });

  test('HEAD has no body; other methods are refused', async () => {
    const head = await handlerWith(passing())(healthEvent('HEAD'));
    expect(head).toMatchObject({ statusCode: 200, body: '' });
    const post = await handlerWith(passing())(healthEvent('POST'));
    expect(post.statusCode).toBe(405);
  });

  test('a failed read is fail and 503, with only a generic reason', async () => {
    const checks = passing();
    checks.posts = async () => { throw Object.assign(new Error('AccessDenied on arn:aws:dynamodb:eu-west-1:123456789012:table/BlogSite-Posts'), { name: 'AccessDeniedException' }); };
    const response = await handlerWith(checks)(healthEvent());
    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('fail');
    expect(body.functions.find((f) => f.key === 'posts')).toEqual({ key: 'posts', name: 'Posts', status: 'fail', output: 'read failed' });
    expect(response.body).not.toMatch(/arn:|BlogSite|123456789012|AccessDenied|stack/);
  });

  test('each check has its own timeout, and a slow check is warn (still 200)', async () => {
    let clock = 0;
    const body = await health.checkHealth({
      posts: () => new Promise(() => {}),
      reactions: async () => { clock += health.SLOW_MS + 1; },
      storage: async () => {},
      signin: async () => {},
    }, { timeoutMs: 20, now: () => clock });
    expect(body.functions.find((f) => f.key === 'posts')).toMatchObject({ status: 'fail', output: 'timeout' });
    expect(body.functions.find((f) => f.key === 'reactions')).toMatchObject({ status: 'warn', output: 'slow' });
    expect(body.status).toBe('fail');
    expect(health.healthResponse({ status: 'warn' }).statusCode).toBe(200);
    expect(health.CHECK_TIMEOUT_MS).toBeLessThanOrEqual(2000);
  });

  test('the checks are one cheap read each: GetItem of a fixed key, HeadObject of a known object, the sign-in settings', async () => {
    const sent = [];
    const record = { send: async (command) => { sent.push(command); return {}; } };
    const checks = health.createHealthChecks({
      table: 'posts-table', reactionsTable: 'reactions-table', bucket: 'content-bucket',
      documentClient: record, s3Client: record,
      loadConfig: async () => ({ tenantId: 't', clientId: 'c', clientSecret: 's' }),
    });
    for (const key of KEYS) await checks[key]();
    expect(sent.map((c) => [c.constructor.name, c.input])).toEqual([
      ['GetCommand', { TableName: 'posts-table', Key: { id: health.HEALTH_POST_ID } }],
      ['GetCommand', { TableName: 'reactions-table', Key: { pk: `post#${health.HEALTH_POST_ID}`, sk: 'counts' } }],
      ['HeadObjectCommand', { Bucket: 'content-bucket', Key: health.CONTENT_INDEX }],
    ]);
    expect(health.HEALTH_POST_ID).not.toMatch(/^\d{10}$/);
    const unset = health.createHealthChecks({ loadConfig: async () => ({ tenantId: 't', clientId: '', clientSecret: 's' }) });
    await expect(unset.signin()).rejects.toThrow();
  });
});

describe('/docs#health and /docs/health.md', () => {
  test('both exist: a Testing tab on /docs, which links the Markdown file as the technical version for machines', () => {
    expect(page).toMatch(/^<article id="health" class="dl-docs health-doc" hidden>/);
    expect(docsHtml).toContain('<a href="#health" data-tab="health" data-zh="测试">Testing</a>');
    expect(read('web/docs.js')).toContain("const TABS = ['architecture', 'cost', 'security', 'api', 'health'];");
    expect(fs.existsSync(path.join(ROOT, 'web/docs-health.html'))).toBe(false);
    // docs.js redraws every tab on a language change; the icons (span.dg-icon) are added only once.
    expect(read('web/docs.js')).toContain("if (!step.querySelector(':scope > .dg-icon')) step.prepend(icon(step.dataset.icon));");
    expect(read('web/docs.js')).toContain("api: staticTab, health: staticTab");
    expect(read('web/diagram.js')).toContain("el('span', 'dg-icon')");
    expect(page).toContain('<a href="/docs/health.md" data-zh="面向机器的技术版本（Markdown）">Technical version for machines (Markdown)</a>');
    expect(page.match(/<a /g)).toHaveLength(1);
    expect(docsHtml).toContain('<link rel="alternate" type="text/markdown" href="/docs/health.md"');
    expect(markdown).toMatch(/^# How to test blog\.dliu\.com\n/);
    for (const title of ['Functions', 'Guest checks', 'Health endpoint', 'Not tested', 'Rules']) expect(section(title)).not.toBe('');
  });

  test('the tab shows rather than tells: numbers, flows with pass, warn and fail, a table and a chart', () => {
    expect(page.match(/class="dg-stat"/g).length).toBeGreaterThanOrEqual(4);
    expect(page.match(/class="dg-flow"/g).length).toBeGreaterThanOrEqual(2);
    expect(page.match(/class="dg-step[ "]/g).length).toBeGreaterThanOrEqual(7);
    expect(page.match(/class="dg-arrow"/g).length).toBeGreaterThanOrEqual(5);
    for (const tone of ['dg-good', 'dg-warn', 'dg-bad']) expect(page).toContain(`class="dg-step ${tone}"`);
    for (const step of ['status.dliu.com', '/health']) expect(page).toContain(`<strong>${step}</strong>`);
    expect(page).toContain('<table class="health-functions">');
    expect(page).toContain('<ul class="bar-chart bar-max-2">');
    expect(page.match(/class="mark mark-good"/g)).toHaveLength(7);
    expect(page.match(/class="mark mark-bad"/g)).toHaveLength(7);
    expect(page).toContain('What isn’t tested');
  });

  test('no exact technical details: no code, folded blocks, URLs, status codes, headers or JSON', () => {
    expect(page).not.toMatch(/<code|<pre|<details|https?:\/\/|\b(200|302|401|503)\b|application\/|max-age|Cache-Control|Content-Type|\{"/);
  });

  test('the function keys and names agree in the tab, the Markdown file and the endpoint, and so do the counts', () => {
    const mdFunctions = tableRows(section('Functions')).map(([key, name]) => [unquote(key), name]);
    const pageFunctions = [...page.matchAll(/<tr data-function="([a-z]+)"><td><strong data-zh="[^"]+">([^<]+)<\/strong>/g)].map(([, key, name]) => [key, name]);
    expect(pageFunctions).toHaveLength(7);
    expect(pageFunctions).toEqual(mdFunctions);
    for (const { key, name } of health.FUNCTIONS) expect(new Map(mdFunctions).get(key)).toBe(name);

    const mdHealth = tableRows(section('Health endpoint')).map(([key, name]) => [unquote(key), name]);
    expect(mdHealth).toEqual(health.FUNCTIONS.map((f) => [f.key, f.name]));
    expect(section('Guest checks')).toContain(`Its function keys are ${KEYS.slice(0, -1).map((k) => `\`${k}\``).join(', ')} and \`${KEYS.at(-1)}\`.`);
    const mdExample = JSON.parse(section('Health endpoint').match(/```json\n([\s\S]*?)```/)[1]);
    expect(mdExample.functions.map(({ key, name }) => ({ key, name }))).toEqual(health.FUNCTIONS);

    // The chart: one bar per function, with its guest checks (links) and its /health self-check.
    const mdChecks = tableRows(section('Guest checks')).map(([key]) => unquote(key));
    const bars = [...page.matchAll(/<li data-key="([a-z]+)" data-links="(\d)" data-self="(\d)"><span class="bar-label" data-zh="[^"]+">([^<]+)<\/span><span class="bar">(.*?)<\/span><span class="bar-value">(\d+)</g)];
    expect(bars.map(([, key, , , name]) => [key, name])).toEqual(mdFunctions);
    for (const [, key, links, self, , units, value] of bars) {
      const expected = [mdChecks.filter((k) => k === key).length, KEYS.includes(key) ? 1 : 0];
      expect([key, Number(links), Number(self)]).toEqual([key, ...expected]);
      expect([key, (units.match(/bar-a/g) || []).length, (units.match(/bar-b/g) || []).length, Number(value)])
        .toEqual([key, ...expected, expected[0] + expected[1]]);
    }
    // The numbers: functions, checks (links + self-checks) and places.
    expect(page).toContain(`<strong>${mdFunctions.length}</strong><small data-zh="项功能被检查">functions tested</small>`);
    expect(page).toContain(`<strong>${mdChecks.length + KEYS.length}</strong><small data-zh="项检查：${mdChecks.length} 个页面和链接，${KEYS.length} 项自检">checks: ${mdChecks.length} pages and links, ${KEYS.length} self-checks</small>`);
  });

  test('the guest checks are read only: GET (or HEAD) on the public site, never a write', () => {
    for (const [, method, url] of tableRows(section('Guest checks'))) {
      expect(['GET', 'HEAD']).toContain(method);
      expect(url).toMatch(/^https:\/\/blog\.dliu\.com\//);
    }
    expect(section('Rules')).toContain('never `POST`, `PUT` or `DELETE`');
  });
});
