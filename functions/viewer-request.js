// CloudFront Function (cloudfront-js-2.0), viewer request on the site's default behaviour.
// - Posts live at /<postId> (yyyymmddNN, e.g. /2026102701); they and /admin/... are pages of the
//   single-page app (index.html). /docs is docs.html.
// - For /<postId> the ID goes in x-blog-post: the post-page behaviour asks the API Lambda for index.html
//   with the post's link-preview tags (falling back to the plain file), and caches per ID.
//   /<postId>/ redirects to /<postId>. A viewer can't send its own x-blog-post.
// - /docs/api is docs-api.html (the API guide for people; agents read /docs/api.md).
// - On /api/* and /auth/*, the viewer's IP goes in x-blog-viewer (replacing any sent) for the reactions
//   rate limit.
// - On /api/*, "Authorization: Bearer <token>" is copied to x-blog-token: CloudFront signs requests to the
//   Lambda origin (origin access control) and that replaces the viewer's Authorization header.
// - Old links keep working: /posts/<postId> → /<postId>; WordPress /2025/04/ → /?m=202504,
//   /page/2/ and /<slug>/ → / (one list, no slugs), /wp-admin and /wp-login.php → /admin.
var RESERVED = { api: true, auth: true, content: true, media: true };

function redirect(location, status) {
  return {
    statusCode: status,
    statusDescription: status === 301 ? 'Moved Permanently' : 'Found',
    headers: { location: { value: location }, 'cache-control': { value: 'max-age=3600' } },
  };
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var match;
  delete request.headers['x-blog-post'];
  if (uri.indexOf('/api/') === 0 || uri.indexOf('/auth/') === 0) {
    var authorization = request.headers.authorization;
    match = authorization ? /^Bearer\s+(\S+)\s*$/i.exec(authorization.value) : null;
    if (match && uri.indexOf('/api/') === 0) request.headers['x-blog-token'] = { value: match[1] };
    else delete request.headers['x-blog-token'];
    if (event.viewer && event.viewer.ip) request.headers['x-blog-viewer'] = { value: event.viewer.ip };
    else delete request.headers['x-blog-viewer'];
    return request;
  }
  match = /^\/(\d{10})(\/?)$/.exec(uri);
  if (match && match[2]) return redirect('/' + match[1], 301);
  if (match) {
    request.headers['x-blog-post'] = { value: match[1] };
    request.uri = '/index.html';
    return request;
  }
  if (uri === '/admin' || uri.indexOf('/admin/') === 0) {
    request.uri = '/index.html';
    return request;
  }
  if (uri === '/docs' || uri === '/docs/') {
    request.uri = '/docs.html';
    return request;
  }
  if (uri === '/docs/api' || uri === '/docs/api/') {
    request.uri = '/docs-api.html';
    return request;
  }
  match = /^\/posts\/(\d{10})\/?$/.exec(uri);
  if (match) return redirect('/' + match[1], 301);
  if (uri === '/posts' || uri.indexOf('/posts/') === 0) return redirect('/', 301);
  if (uri === '/wp-admin' || uri.indexOf('/wp-admin/') === 0 || uri === '/wp-login.php') return redirect('/admin', 302);
  match = /^\/(\d{4})\/(\d{2})\/?$/.exec(uri);
  if (match) return redirect('/?m=' + match[1] + match[2], 301);
  match = /^\/page\/(\d{1,4})\/?$/.exec(uri);
  if (match) return redirect('/', 301);
  match = /^\/([^\/.]+)\/?$/.exec(uri);
  if (match && !RESERVED[match[1]]) return redirect('/', 301);
  return request;
}
