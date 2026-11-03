'use strict';

// The dliu.com health contract (status.dliu.com): GET /health, /docs/health (people) and /docs/health.md (machines).
const fs = require('node:fs');
const path = require('node:path');
const { createHandler } = require('../lambda/api/index');
const health = require('../lambda/api/health');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const page = read('web/docs-health.html');
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

describe('/docs/health and /docs/health.md', () => {
  test('both exist, and the page links the Markdown file as the full technical version', () => {
    expect(page).toContain('<a href="/docs/health.md" data-zh="完整技术版本（Markdown）">Full technical version (Markdown)</a>');
    expect(page).toContain('<link rel="alternate" type="text/markdown" href="/docs/health.md"');
    expect(markdown).toMatch(/^# How to test blog\.dliu\.com\n/);
    for (const title of ['Functions', 'Guest checks', 'Health endpoint', 'Not tested', 'Rules']) expect(section(title)).not.toBe('');
  });

  test('the page has the diagram: the guest, the public pages, /health and the dependencies, then pass, warn and fail', () => {
    expect(page).toMatch(/<figure class="dg[ "]/);
    expect(page.match(/class="dg-flow"/g).length).toBeGreaterThanOrEqual(2);
    expect(page.match(/class="dg-step[ "]/g).length).toBeGreaterThanOrEqual(7);
    expect(page.match(/class="dg-arrow"/g).length).toBeGreaterThanOrEqual(5);
    for (const tone of ['dg-good', 'dg-warn', 'dg-bad']) expect(page).toContain(`class="dg-step ${tone}"`);
    for (const step of ['status.dliu.com', '/health']) expect(page).toContain(`<strong>${step}</strong>`);
  });

  test('every technical detail is folded: outside closed <details>, the page has no code, URLs or status codes', () => {
    expect(page).not.toMatch(/<details[^>]*\sopen/);
    const article = page.slice(page.indexOf('<article'), page.indexOf('</article>'));
    const unfolded = article.replace(/<details class="dg-more">[\s\S]*?<\/details>/g, '');
    expect(article.match(/<details class="dg-more">/g).length).toBeGreaterThanOrEqual(2);
    expect(unfolded).not.toMatch(/<code|<pre|https:\/\/|\b(200|302|503)\b|application\/|max-age/);
    expect(unfolded).toContain('What isn’t tested');
  });

  test('the function keys and names agree in the page, the Markdown file and the endpoint', () => {
    const mdFunctions = tableRows(section('Functions')).map(([key, name]) => [unquote(key), name]);
    const pageFunctions = [...page.matchAll(/<li data-function="([a-z]+)"><strong data-zh="[^"]+">([^<]+)<\/strong>/g)].map(([, key, name]) => [key, name]);
    expect(pageFunctions).toHaveLength(7);
    expect(new Map(pageFunctions)).toEqual(new Map(mdFunctions));
    for (const { key, name } of health.FUNCTIONS) expect(new Map(mdFunctions).get(key)).toBe(name);

    const mdChecks = tableRows(section('Guest checks')).map(([key]) => unquote(key));
    const pageChecks = [...page.matchAll(/<li data-check="([a-z]+)">/g)].map(([, key]) => key);
    expect(pageChecks).toEqual(mdChecks);
    for (const key of mdChecks) expect(mdFunctions.map(([k]) => k)).toContain(key);

    const mdHealth = tableRows(section('Health endpoint')).map(([key, name]) => [unquote(key), name]);
    const pageHealth = [...page.matchAll(/<li data-health="([a-z]+)"><code>\1<\/code> \(([^)]+)\)/g)].map(([, key, name]) => [key, name]);
    expect(mdHealth).toEqual(health.FUNCTIONS.map((f) => [f.key, f.name]));
    expect(pageHealth).toEqual(mdHealth);
    expect(section('Guest checks')).toContain(`Its function keys are ${KEYS.slice(0, -1).map((k) => `\`${k}\``).join(', ')} and \`${KEYS.at(-1)}\`.`);

    // The example responses in both are valid and list exactly the endpoint's functions.
    const mdExample = JSON.parse(section('Health endpoint').match(/```json\n([\s\S]*?)```/)[1]);
    const pageExample = JSON.parse(page.match(/<pre class="code">([\s\S]*?)<\/pre>/)[1]);
    expect(mdExample).toEqual(pageExample);
    expect(mdExample.functions.map(({ key, name }) => ({ key, name }))).toEqual(health.FUNCTIONS);
  });

  test('the guest checks are read only: GET (or HEAD) on the public site, never a write', () => {
    for (const [, method, url] of tableRows(section('Guest checks'))) {
      expect(['GET', 'HEAD']).toContain(method);
      expect(url).toMatch(/^https:\/\/blog\.dliu\.com\//);
    }
    expect(section('Rules')).toContain('never `POST`, `PUT` or `DELETE`');
  });
});
