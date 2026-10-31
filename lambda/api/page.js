'use strict';

// Post pages with link-preview tags. CloudFront sends /<postId> here as /index.html with the ID in
// x-blog-post (see functions/viewer-request.js). The page is the site's own index.html with the
// title, description and Open Graph tags of the post, so WeChat, iMessage, Slack, WhatsApp and
// others show the post's title, text and picture when the link is shared. Anything that isn't a
// published post is a 404 and CloudFront falls back to the plain index.html in the site bucket.

const SITE_TITLE = 'DL blog';
const SHARE_IMAGE = '/share.png';
const TEMPLATE_TTL_MS = 60 * 1000;
const SHARE_BLOCK = /<!-- share -->[\s\S]*?<!-- \/share -->/;

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Control characters and runs of spaces don't belong in a preview.
const clean = (text) => String(text || '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();

function shareTags({ title, description, url, image, type = 'website', publishedAt, updatedAt }) {
  const tags = [
    ['property', 'og:type', type],
    ['property', 'og:site_name', SITE_TITLE],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', url],
    ['property', 'og:image', image],
    ['property', 'article:published_time', publishedAt],
    ['property', 'article:modified_time', updatedAt],
    ['name', 'twitter:card', 'summary'],
    // QQ and WeChat also read schema.org microdata.
    ['itemprop', 'name', title],
    ['itemprop', 'description', description],
    ['itemprop', 'image', image],
  ];
  const meta = tags.filter(([, , value]) => value).map(([attr, name, value]) => `<meta ${attr}="${name}" content="${escapeHtml(value)}">`);
  return ['<!-- share -->', `<link rel="canonical" href="${escapeHtml(url)}">`, ...meta, '<!-- /share -->'].join('\n  ');
}

// The post's own picture (always a /media/ path on this site), else the site picture.
function imageOf(post, siteUrl) {
  const cover = String(post.cover || '');
  return `${siteUrl}${/^\/media\/[^\s"'<>]+$/.test(cover) ? cover : SHARE_IMAGE}`;
}

function renderPostPage(template, post, siteUrl) {
  if (!SHARE_BLOCK.test(template)) throw new Error('index.html has no <!-- share --> block');
  const title = clean(post.title) || 'Untitled';
  const description = clean(post.excerpt) || `${title} · ${SITE_TITLE}`;
  const image = imageOf(post, siteUrl);
  const tags = shareTags({
    title,
    description,
    url: `${siteUrl}/${post.id}`,
    image,
    type: 'article',
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
  });
  return template
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(`${title} · ${SITE_TITLE}`)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escapeHtml(description)}">`)
    .replace(SHARE_BLOCK, () => tags)
    // WeChat's browser, without its JS-SDK, takes the first big picture on the page as the thumbnail.
    .replace(/<img class="share-image" src="[^"]*"/, () => `<img class="share-image" src="${escapeHtml(image)}"`);
}

// index.html from the site bucket, re-read every minute so a deploy shows up quickly.
function createTemplateLoader({ bucket = process.env.SITE_BUCKET, client, now = Date.now } = {}) {
  let cached;
  let cachedAt = 0;
  let s3 = client;
  return async function loadTemplate() {
    if (cached && now() - cachedAt < TEMPLATE_TTL_MS) return cached;
    const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
    s3 = s3 || new S3Client({});
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: 'index.html' }));
    cached = await result.Body.transformToString('utf-8');
    cachedAt = now();
    return cached;
  };
}

module.exports = { SHARE_IMAGE, createTemplateLoader, renderPostPage, shareTags };
