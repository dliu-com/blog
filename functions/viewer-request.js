// CloudFront Function (cloudfront-js-2.0), viewer request on the site's default behaviour.
// - /posts/<slug> and /admin/... are pages of the single-page app (index.html).
// - Old WordPress links keep working: /<slug>/ → /posts/<slug>, /2025/04/ → /?m=202504,
//   /page/2/ → /?paged=2, /wp-admin and /wp-login.php → /admin.
var RESERVED = { posts: true, admin: true, api: true, auth: true, content: true, media: true, page: true };

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
  if (uri === '/admin' || uri.indexOf('/admin/') === 0 || uri.indexOf('/posts/') === 0) {
    request.uri = '/index.html';
    return request;
  }
  if (uri === '/wp-admin' || uri.indexOf('/wp-admin/') === 0 || uri === '/wp-login.php') return redirect('/admin', 302);
  match = /^\/(\d{4})\/(\d{2})\/?$/.exec(uri);
  if (match) return redirect('/?m=' + match[1] + match[2], 301);
  match = /^\/page\/(\d{1,4})\/?$/.exec(uri);
  if (match) return redirect('/?paged=' + match[1], 301);
  match = /^\/([^\/.]+)\/?$/.exec(uri);
  if (match && !RESERVED[match[1]]) return redirect('/posts/' + match[1], 301);
  return request;
}
