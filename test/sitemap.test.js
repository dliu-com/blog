'use strict';

const SITE_URL = 'https://blog.dliu.com';
process.env.SITE_URL = SITE_URL;

const fs = require('fs');
const path = require('path');
const auth = require('../lambda/api/auth');
const { createHandler } = require('../lambda/api/index');
const { buildSitemap, sitemapEntries } = require('../lambda/api/sitemap');
const { createMemoryFiles } = require('../scripts/memory-files');
const { createMemoryStore } = require('../scripts/memory-store');

const NOW = Date.UTC(2026, 9, 1, 12);
const config = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret' };

function setup() {
  let clock = NOW;
  const handler = createHandler({ store: createMemoryStore(), files: createMemoryFiles(), loadConfig: async () => config, now: () => clock });
  const session = auth.issueSession({ user: 'user@example.com', name: 'Dewei' }, config, NOW);
  const call = (method, rawPath, { body, signedIn = true, headers = {}, query } = {}) => handler({
    rawPath,
    queryStringParameters: query,
    headers: { origin: SITE_URL, 'content-type': 'application/json', ...headers },
    cookies: signedIn ? [`${auth.SESSION_COOKIE}=${session}`] : [],
    requestContext: { http: { method } },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const create = async (fields) => JSON.parse((await call('POST', '/api/posts', { body: fields })).body);
  const update = (id, fields) => call('PUT', `/api/posts/${id}`, { body: fields });
  const locs = async () => [...(await call('GET', '/sitemap.xml', { signedIn: false })).body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc);
  return { call, create, update, locs, tick: (ms) => { clock += ms; } };
}

describe('/sitemap.xml', () => {
  test('lists the home page, /docs and exactly the published posts, and follows publishing and unpublishing', async () => {
    const { create, update, locs, tick } = setup();
    expect(await locs()).toEqual([`${SITE_URL}/`, `${SITE_URL}/docs`]);
    const first = await create({ title: 'First', content: 'a' });
    const draft = await create({ title: 'Draft', content: 'b' });
    expect(await locs()).toEqual([`${SITE_URL}/`, `${SITE_URL}/docs`]);
    await update(first.id, { status: 'published' });
    tick(60000);
    const second = await create({ title: 'Second', content: 'c' });
    await update(second.id, { status: 'published' });
    expect(await locs()).toEqual([`${SITE_URL}/`, `${SITE_URL}/docs`, `${SITE_URL}/${second.id}`, `${SITE_URL}/${first.id}`]);
    await update(first.id, { status: 'draft' });
    expect(await locs()).toEqual([`${SITE_URL}/`, `${SITE_URL}/docs`, `${SITE_URL}/${second.id}`]);
    expect(await locs()).not.toContain(`${SITE_URL}/${draft.id}`);
  });

  test('is valid sitemap XML for guests, cached for an hour, and reads nothing from the request', async () => {
    const { call, create, update } = setup();
    const post = await create({ title: 'Hello <&>', content: 'x' });
    await update(post.id, { status: 'published' });
    const res = await call('GET', '/sitemap.xml', { signedIn: false, headers: { cookie: 'x=1', authorization: 'Bearer x' }, query: { a: '1' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers).toMatchObject({ 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' });
    expect(res.body).toBe(['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      `  <url><loc>${SITE_URL}/</loc><lastmod>2026-10-01</lastmod></url>`,
      `  <url><loc>${SITE_URL}/docs</loc></url>`,
      `  <url><loc>${SITE_URL}/${post.id}</loc><lastmod>2026-10-01</lastmod></url>`, '</urlset>', ''].join('\n'));
    expect((await call('GET', '/sitemap.xml', { signedIn: true })).body).toBe(res.body);
    expect((await call('HEAD', '/sitemap.xml', { signedIn: false })).body).toBe('');
    expect((await call('POST', '/sitemap.xml', { signedIn: false })).statusCode).toBe(405);
  });

  test('uses each post’s last update as lastmod, the newest for the home page, and skips odd or unpublished items', () => {
    const entries = sitemapEntries([
      { id: '2026010100', status: 'published', publishedAt: '2026-01-01T10:00:00Z', updatedAt: '2026-03-05T10:00:00Z' },
      { id: '2026020100', status: 'published', publishedAt: '2026-02-01T10:00:00Z' },
      { id: '2026030100', status: 'draft', publishedAt: '2026-03-01T10:00:00Z', updatedAt: '2026-04-01T10:00:00Z' },
      { id: 'health-check', status: 'published', publishedAt: '2026-05-01T10:00:00Z' },
    ], SITE_URL);
    expect(entries).toEqual([
      { loc: `${SITE_URL}/`, lastmod: '2026-03-05' },
      { loc: `${SITE_URL}/docs`, lastmod: null },
      { loc: `${SITE_URL}/2026020100`, lastmod: '2026-02-01' },
      { loc: `${SITE_URL}/2026010100`, lastmod: '2026-03-05' },
    ]);
    expect(buildSitemap([], 'https://example.com/?a&b')).toContain('<loc>https://example.com/?a&amp;b/</loc>');
  });

  test('robots.txt allows crawling and points to the sitemap; the static placeholder is gone', () => {
    const web = path.join(__dirname, '..', 'web');
    expect(fs.readFileSync(path.join(web, 'robots.txt'), 'utf8')).toBe('User-agent: *\nAllow: /\n\nSitemap: https://blog.dliu.com/sitemap.xml\n');
    expect(fs.existsSync(path.join(web, 'sitemap.xml'))).toBe(false);
  });
});
