// Header for the docs pages: the same buttons as the blog.

function link(className, href, text) {
  const a = document.createElement('a');
  a.className = className;
  a.href = href;
  a.textContent = text;
  return a;
}

// Signed in, the header is crowded on phones, so the button shows only its icon there (still labelled Docs).
function docsButton(signedIn = false) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  for (const d of ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6M9 17h6']) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'Docs';
  const a = document.createElement('a');
  a.className = signedIn ? 'button docs-link icon-narrow' : 'button docs-link';
  a.href = '/docs';
  a.title = 'How this blog works';
  a.setAttribute('aria-label', 'Docs');
  a.append(svg, label);
  if (/^\/docs(\/|$)/.test(location.pathname)) a.setAttribute('aria-current', 'page');
  return a;
}

// Same header as the blog. The hint cookie tells whether the author is signed in, without calling the API.
export function renderNav() {
  const nav = document.getElementById('nav');
  const signedIn = /(?:^|;\s*)blog_signed_in=1(?:;|$)/.test(document.cookie);
  if (!signedIn) {
    nav.replaceChildren(docsButton(), link('button primary sign-in', `/auth/login?return=${encodeURIComponent(location.pathname)}`, 'Sign in'));
    return;
  }
  nav.replaceChildren(
    docsButton(true),
    link('button', '/admin', 'Posts'),
    link('button primary', '/admin/new', '＋ New post'),
    link('button', `/auth/logout?return=${encodeURIComponent(location.pathname)}`, 'Sign out'),
  );
}
