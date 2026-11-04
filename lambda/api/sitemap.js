'use strict';

// /sitemap.xml for search engines: the public, canonical pages only. Built on request from the posts table,
// so publishing or unpublishing a post updates it with nothing stored; CloudFront keeps one copy for an hour.
// Listed: the home page, /docs and every published post (/<postId>, its canonical address).
// Not listed: drafts, /admin, /auth/*, /api/*, /health, the Markdown guides for machines (/docs/*.md),
// filtered or redirecting addresses (/?m=, /posts/..., /docs/api, /docs/health) and media files.

const CACHE_SECONDS = 3600;
const PAGES = ['/', '/docs'];

const escapeXml = (text) => String(text).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
const day = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(iso) ? iso.slice(0, 10) : null);

// items: post summaries from the store (any status). Returns [{ loc, lastmod? }], newest posts first.
function sitemapEntries(items, siteUrl) {
  const posts = items
    .filter((item) => item.status === 'published' && /^\d{10}$/.test(item.id))
    .map((item) => ({ id: item.id, publishedAt: String(item.publishedAt || ''), lastmod: day(item.updatedAt) || day(item.publishedAt) }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));
  const newest = posts.map((post) => post.lastmod).filter(Boolean).sort().at(-1) || null;
  return [
    { loc: `${siteUrl}${PAGES[0]}`, lastmod: newest },
    { loc: `${siteUrl}${PAGES[1]}`, lastmod: null },
    ...posts.map((post) => ({ loc: `${siteUrl}/${post.id}`, lastmod: post.lastmod })),
  ];
}

function buildSitemap(items, siteUrl) {
  const urls = sitemapEntries(items, siteUrl).map(({ loc, lastmod }) =>
    `  <url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}

function sitemapResponse(xml, method = 'GET') {
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // CloudFront's /sitemap.xml cache policy keys on nothing, so the table is read at most about once an hour per edge.
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
      'x-content-type-options': 'nosniff',
    },
    body: method === 'HEAD' ? '' : xml,
  };
}

module.exports = { CACHE_SECONDS, buildSitemap, sitemapEntries, sitemapResponse };
