'use strict';

const auth = require('./auth');
const { loadConfig, NotConfigured } = require('./config');
const { createFiles, mediaKey, mediaUrl, servedType } = require('./s3');
const { createStore, Conflict, Exists, NotFound, TooLarge } = require('./store');
const apiAccess = require('./api-access');
const ROUTES = require('./routes.json');
const reactions = require('./reactions');
const { createTemplateLoader, renderPostPage } = require('./page');
const {
  BadRequest, FILE_ID, MAX_FILES, MAX_POSTS_PER_DAY, POST_ID, buildIndex, compareSummaries, derive, newFileId, nextPostNumber, postIdFor, postIdPrefix,
  parsePostUpdate, parseUpload, toApiPost, toPublicPost, toSummary,
} = require('./posts');

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
const MAX_BODY_BYTES = 300 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function header(event, name) {
  const headers = event.headers || {};
  return headers[name] || headers[name.toLowerCase()];
}

function json(statusCode, body, cookies) {
  return {
    statusCode,
    headers: { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' },
    ...(cookies ? { cookies } : {}),
    body: JSON.stringify(body),
  };
}

function redirect(location, cookies) {
  return { statusCode: 302, headers: { ...SECURITY_HEADERS, location }, ...(cookies ? { cookies } : {}), body: '' };
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function errorPage(statusCode, message, cookies) {
  return {
    statusCode,
    headers: { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' },
    ...(cookies ? { cookies } : {}),
    body: `<!doctype html><meta charset="utf-8"><title>DL blog</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto">
<h1>Sign-in problem</h1><p>${escapeHtml(message)}</p><p><a href="/auth/login?return=/admin">Try again</a> · <a href="/">Back to the blog</a></p></body>`,
  };
}

// The scope is chosen by routeKey but the work by method and path, so they must agree.
function matchesRoute(routeKey, method, path) {
  const [routeMethod, template] = routeKey.split(' ');
  const expected = template.split('/');
  const actual = path.split('/');
  return routeMethod === method && expected.length === actual.length &&
    expected.every((segment, index) => (/^\{\w+\}$/.test(segment) ? actual[index] !== '' : segment === actual[index]));
}

function readBody(event) {
  const raw = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8') : Buffer.alloc(0);
  if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large');
  if (!/^application\/json\b/i.test(header(event, 'content-type') || '')) throw new HttpError(415, 'Expected application/json');
  try {
    return JSON.parse(raw.toString('utf8') || 'null');
  } catch {
    throw new BadRequest('Invalid JSON');
  }
}

function createHandler(deps = {}) {
  const getConfig = deps.loadConfig || loadConfig;
  const store = deps.store || createStore();
  const files = deps.files || createFiles();
  const loadTemplate = deps.loadTemplate || createTemplateLoader();
  const fetchImpl = deps.fetchImpl || ((...args) => fetch(...args));
  const clock = deps.now || Date.now;
  const isoNow = () => new Date(clock()).toISOString();

  // Cookies are SameSite=Lax; also insist that website writes come from our own pages. The managed API skips
  // this: its Microsoft bearer token is never sent by a browser on its own, and the gateway allows no CORS.
  function requireSameOrigin(event, user) {
    if (user && user.via === 'microsoft-api') return;
    if (header(event, 'origin') !== process.env.SITE_URL) throw new HttpError(403, 'Cross-site request refused');
  }

  // The website entry point (CloudFront) knows only the session cookie; bearer tokens are never read there.
  async function authenticate(event, caller) {
    if (caller) return caller;
    return auth.getSession(event, await getConfig(), clock());
  }

  async function getPost(id) {
    const item = await store.getPost(id);
    if (!item) throw new NotFound('Post not found');
    return item;
  }

  // Published posts are static JSON in the content bucket (posts/<id>.json); readers never call the API.
  async function syncPublic(before, after) {
    const wasPublished = Boolean(before && before.status === 'published');
    const isPublished = Boolean(after && after.status === 'published');
    if (wasPublished && !isPublished) await files.deleteContent(`posts/${before.id}.json`);
    if (isPublished) await files.putContent(`posts/${after.id}.json`, toPublicPost(after));
    if (wasPublished || isPublished) await files.putContent('index.json', buildIndex(await store.listPosts(), isoNow()));
  }

  async function save(before, post, user, { create = false } = {}) {
    post.updatedAt = isoNow();
    post.updatedBy = user.user;
    if (user.via === 'microsoft-api') post.updatedVia = 'Microsoft API';
    else delete post.updatedVia;
    derive(post);
    await store.putPost(post, { create });
    await syncPublic(before, post);
    return post;
  }

  // Readers' reactions: GET the counts and your own; POST {"reaction": "love"} or {"reaction": null}.
  // The visitor is the dl_vid cookie (set here if the browser has none yet). No sign-in.
  async function reactionsApi(method, parts, event) {
    const [, postId] = parts;
    if (parts.length !== 2 || !POST_ID.test(postId)) throw new NotFound('Not found');
    const cookie = auth.parseCookies(event)[reactions.VISITOR_COOKIE] || '';
    const known = reactions.VISITOR_ID.test(cookie) ? cookie : '';
    if (method === 'GET') {
      const { counts, mine } = await store.getReactions(postId, known);
      return json(200, { counts: reactions.toCounts(counts), mine });
    }
    if (method !== 'POST') throw new HttpError(405, 'Method not allowed');
    requireSameOrigin(event);
    let reaction;
    try {
      reaction = reactions.parseReaction(readBody(event));
    } catch (error) {
      if (error instanceof reactions.ReactionInputError) throw new BadRequest(error.message);
      throw error;
    }
    const post = await store.getPost(postId);
    if (!post || post.status !== 'published') throw new NotFound('Post not found');
    // x-blog-viewer is the viewer's IP, set by the CloudFront function (a viewer can't send its own).
    const span = reactions.RATE_WINDOW_SECONDS;
    const windowStart = Math.floor(clock() / 1000 / span) * span;
    const allowed = await store.countRequest(reactions.viewerKey(header(event, 'x-blog-viewer')), windowStart, reactions.RATE_LIMIT, windowStart + 2 * span);
    if (!allowed) throw new HttpError(429, 'Too many reactions from your network. Please try again later.');

    const visitor = known || reactions.newVisitorId(clock());
    for (let attempt = 0; ; attempt += 1) {
      const { mine } = await store.getReactions(postId, visitor);
      if (mine === reaction) break;
      try {
        await store.setReaction(postId, visitor, mine, reaction, isoNow());
        break;
      } catch (error) {
        if (!(error instanceof Conflict)) throw error;
        if (attempt >= 2) throw new HttpError(409, 'Your reaction changed at the same time. Please try again.');
      }
    }
    const { counts, mine } = await store.getReactions(postId, visitor);
    const cookies = known ? undefined : [reactions.visitorCookie(visitor, process.env.SITE_URL, process.env.ROOT_DOMAIN)];
    return json(200, { counts: reactions.toCounts(counts), mine }, cookies);
  }

  // caller is the Microsoft API user for managed requests (already authorized for this route), else undefined.
  async function api(method, parts, event, caller) {
    if (parts.length === 1 && parts[0] === 'me' && method === 'GET') {
      try {
        const session = await authenticate(event, caller);
        if (!session) return json(200, { signedIn: false });
        return json(200, { signedIn: true, user: session.user, name: session.name });
      } catch (error) {
        if (error instanceof NotConfigured) return json(200, { signedIn: false, configured: false });
        throw error;
      }
    }
    if (parts[0] === 'reactions' && !caller) return reactionsApi(method, parts, event);
    if (parts[0] !== 'posts') throw new NotFound('Not found');
    const [, postId, sub, fileId] = parts;
    if (postId !== undefined && !POST_ID.test(postId)) throw new NotFound('Post not found');
    // /api/posts/<id>/reactions lists who reacted: website session only, never the Microsoft API.
    if (sub !== undefined && sub !== 'files' && (sub !== 'reactions' || caller || parts.length !== 3)) throw new NotFound('Not found');
    if (fileId !== undefined && !FILE_ID.test(fileId)) throw new NotFound('File not found');

    // Everything under /api/posts is for authors; readers get the static JSON.
    const user = await authenticate(event, caller);
    if (!user || typeof user.user !== 'string' || !user.user) throw new HttpError(401, 'Sign in to do that');
    if (method !== 'GET') requireSameOrigin(event, user);

    if (parts.length === 1) {
      if (method === 'GET') return json(200, { posts: (await store.listPosts()).map(toSummary).sort(compareSummaries) });
      if (method === 'POST') {
        const fields = parsePostUpdate(readBody(event) || {});
        const now = isoNow();
        const post = {
          id: '',
          title: fields.title || '',
          body: fields.body || '',
          status: fields.status || 'draft',
          files: {},
          author: user.user,
          authorName: user.name || user.user,
          createdAt: now,
        };
        if (post.status === 'published') post.publishedAt = now;
        // Ids are yyyymmddNN; the conditional write makes two posts created at once take different numbers.
        const prefix = postIdPrefix(clock());
        let n = nextPostNumber((await store.listPosts()).map((item) => item.id), prefix);
        for (; n < MAX_POSTS_PER_DAY; n += 1) {
          post.id = postIdFor(prefix, n);
          try {
            return json(201, toApiPost(await save(null, post, user, { create: true })));
          } catch (error) {
            if (!(error instanceof Exists)) throw error;
          }
        }
        throw new HttpError(409, `At most ${MAX_POSTS_PER_DAY} posts can be created in one day`);
      }
    }

    if (parts.length === 2) {
      if (method === 'GET') return json(200, toApiPost(await getPost(postId)));
      if (method === 'PUT') {
        const update = parsePostUpdate(readBody(event));
        const before = await getPost(postId);
        const post = structuredClone(before);
        if ('title' in update) post.title = update.title;
        if ('body' in update) post.body = update.body;
        if ('status' in update) post.status = update.status;
        if (post.status === 'published' && !post.publishedAt) post.publishedAt = isoNow();
        return json(200, toApiPost(await save(before, post, user)));
      }
      if (method === 'DELETE') {
        const before = await getPost(postId);
        await store.deletePost(postId);
        await files.removePost(postId);
        await syncPublic(before, null);
        try {
          await store.deleteReactions(postId);
        } catch (error) {
          console.error(JSON.stringify({ message: 'Could not delete reactions', postId, error: error.message }));
        }
        return json(200, { deleted: postId });
      }
    }

    if (sub === 'reactions') {
      if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
      await getPost(postId);
      const cookie = auth.parseCookies(event)[reactions.VISITOR_COOKIE] || '';
      const list = (await store.listReactionVisitors(postId))
        .filter((item) => reactions.VISITOR_ID.test(item.visitor) && reactions.REACTIONS.includes(item.reaction))
        .map((item) => ({
          visitor: item.visitor,
          reaction: item.reaction,
          updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
          you: item.visitor === cookie,
        }))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return json(200, { reactions: list });
    }

    if (sub === 'files') {
      // 1. Ask for an upload URL, 2. PUT the bytes straight to S3, 3. PUT /files/<id> to keep it.
      if (parts.length === 3 && method === 'POST') {
        const upload = parseUpload(readBody(event));
        const post = await getPost(postId);
        if (Object.keys(post.files || {}).length >= MAX_FILES) throw new TooLarge(`A post can have at most ${MAX_FILES} files`);
        const id = newFileId();
        const { url, headers } = files.uploadUrl(postId, id, upload);
        return json(201, { fileId: id, uploadUrl: url, uploadHeaders: headers });
      }
      if (parts.length === 4 && method === 'PUT') {
        const body = readBody(event) || {};
        const before = await getPost(postId);
        if ((before.files || {})[fileId]) return json(200, toApiPost(before));
        const uploaded = await files.uploaded(postId, fileId);
        if (!uploaded) throw new NotFound('Upload not found. Try again.');
        const file = parseUpload({ name: body.name, size: uploaded.size, type: uploaded.type });
        const key = mediaKey(postId, fileId, file.name);
        await files.keep(postId, fileId, file, key);
        const post = structuredClone(before);
        post.files = { ...(post.files || {}) };
        post.files[fileId] = {
          name: file.name,
          type: servedType(file.type),
          size: file.size,
          key,
          url: mediaUrl(key),
          uploadedAt: isoNow(),
          uploadedBy: user.user,
        };
        return json(201, toApiPost(await save(before, post, user)));
      }
      if (parts.length === 4 && method === 'DELETE') {
        const before = await getPost(postId);
        const file = (before.files || {})[fileId];
        if (!file) throw new NotFound('File not found');
        const post = structuredClone(before);
        delete post.files[fileId];
        await save(before, post, user);
        await files.remove(file.key);
        return json(200, toApiPost(post));
      }
    }
    throw new HttpError(405, 'Method not allowed');
  }

  // A published post's page with its link-preview tags; a 404 makes CloudFront serve the plain index.html.
  async function postPage(event, method) {
    if (method !== 'GET' && method !== 'HEAD') return json(405, { error: 'Method not allowed' });
    const id = header(event, 'x-blog-post') || '';
    const item = POST_ID.test(id) ? await store.getPost(id) : null;
    if (!item || item.status !== 'published') return json(404, { error: 'Not found' });
    return {
      statusCode: 200,
      headers: {
        ...SECURITY_HEADERS,
        'content-type': 'text/html; charset=utf-8',
        // CloudFront keeps it for five minutes; edits change the preview after that. Browsers revalidate.
        'cache-control': 'public, max-age=0, s-maxage=300',
      },
      body: method === 'HEAD' ? '' : renderPostPage(await loadTemplate(), item, process.env.SITE_URL),
    };
  }

  return async function handler(event) {
    const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || 'GET';
    const path = event.rawPath || '/';
    const params = event.queryStringParameters || {};
    const siteUrl = process.env.SITE_URL;
    const context = event.requestContext;
    // Only API Gateway sets a JWT authorizer or a route key other than $default (a function URL always sends $default);
    // the function URL itself is reachable only through CloudFront, which signs with origin access control.
    const managedApi = Boolean(context && ((context.authorizer && context.authorizer.jwt) ||
      (context.apiId && context.routeKey && context.routeKey !== '$default')));

    try {
      if (managedApi) {
        // The managed API serves only the routes in routes.json, each with its exact Microsoft scope; no cookies.
        const route = Object.hasOwn(ROUTES, context.routeKey) ? ROUTES[context.routeKey] : null;
        if (!route || !matchesRoute(context.routeKey, method, path)) return json(404, { error: 'Not found' });
        const caller = apiAccess.authorize(event, route.scope);
        if (caller.status) return json(caller.status, { error: caller.error });
        return await api(method, path.slice('/api/'.length).split('/').filter(Boolean), event, { ...caller, via: 'microsoft-api' });
      }
      if (path === '/index.html') return await postPage(event, method);
      if (path.startsWith('/auth/')) {
        if (method !== 'GET') return json(405, { error: 'Method not allowed' });
        if (path === '/auth/logout') return redirect(auth.safeReturnPath(params.return), auth.logoutCookies());
        const config = await getConfig();
        if (path === '/auth/login') {
          const login = auth.startLogin(config, siteUrl, clock(), params.return || '/admin');
          return redirect(login.location, login.cookies);
        }
        if (path === '/auth/callback') {
          const result = await auth.finishLogin(event, config, siteUrl, { fetchImpl, now: clock() });
          return result.location ? redirect(result.location, result.cookies) : errorPage(result.status, result.error, result.cookies);
        }
        return json(404, { error: 'Not found' });
      }
      if (!path.startsWith('/api/')) return json(404, { error: 'Not found' });
      return await api(method, path.slice('/api/'.length).split('/').filter(Boolean), event);
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message });
      if (error instanceof BadRequest) return json(400, { error: error.message });
      if (error instanceof NotFound) return json(404, { error: error.message });
      if (error instanceof TooLarge) return json(413, { error: error.message });
      if (error instanceof NotConfigured) {
        console.error(JSON.stringify({ message: 'Sign-in not configured', path, error: error.message }));
        const text = 'Sign-in is not configured yet. Run "make set-secrets".';
        return path.startsWith('/auth/') ? errorPage(503, text) : json(503, { error: text });
      }
      console.error(JSON.stringify({ message: 'Request failed', method, path, error: error.message, stack: error.stack }));
      if (path.startsWith('/auth/')) return errorPage(500, 'Something went wrong while signing in.');
      return json(500, { error: 'Internal error' });
    }
  };
}

module.exports = { createHandler, HttpError, handler: createHandler() };
