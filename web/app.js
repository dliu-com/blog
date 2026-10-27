'use strict';

// Public pages read static JSON (/content/index.json, /content/posts/<slug>.json) straight from CloudFront.
// Only the admin pages (/admin…) and signed-in authors call the API.
(() => {
  const SITE_TITLE = 'Dewei Blog';
  const SITE_TAGLINE = '';
  const PER_PAGE = 10;
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const root = document.getElementById('root');
  const adminbar = document.getElementById('adminbar');
  const md = window.BlogMarkdown;

  // ---------- helpers ----------
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'value') node.value = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children)) if (child != null && child !== false && child !== '') node.append(child);
    return node;
  }

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function api(method, path, body) {
    const init = { method, credentials: 'same-origin', headers: { accept: 'application/json' } };
    if (method !== 'GET') {
      const payload = body === undefined ? '' : JSON.stringify(body);
      if (payload) {
        init.body = payload;
        init.headers['content-type'] = 'application/json';
      }
      // CloudFront signs requests to the Lambda origin (OAC) and needs the body hash from the browser.
      init.headers['x-amz-content-sha256'] = await sha256Hex(payload);
    }
    const response = await fetch(path, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const monthKey = (iso) => String(iso || '').slice(0, 7).replace('-', '');
  const monthLabel = (key) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4)) - 1, 1))
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const postPath = (slug) => `/posts/${encodeURIComponent(slug)}`;
  const fmtSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const isImage = (type) => /^image\/(png|jpe?g|gif|webp|avif)$/.test(type || '');
  const untitled = (title) => title || '(no title)';
  const setTitle = (...parts) => { document.title = [...parts.filter(Boolean), SITE_TITLE].join(' – '); };

  // ---------- who is signed in ----------
  // The hint cookie is set at sign-in, so readers who never signed in don't call the API at all.
  const hasHint = () => /(?:^|;\s*)blog_signed_in=1(?:;|$)/.test(document.cookie);
  async function whoAmI({ force = false } = {}) {
    if (!force && !hasHint()) return { signedIn: false };
    try {
      const me = await api('GET', '/api/me');
      if (!me.signedIn && hasHint()) document.cookie = 'blog_signed_in=; Path=/; Max-Age=0; SameSite=Lax';
      return me;
    } catch {
      return { signedIn: false };
    }
  }

  function showAdminBar(me, { editId, viewSlug } = {}) {
    if (!me.signedIn) return;
    adminbar.replaceChildren(
      el('div', {}, [
        el('a', { class: 'ab-site', href: '/', text: SITE_TITLE }),
        el('a', { href: '/admin', text: 'Dashboard' }),
        el('a', { href: '/admin/new', text: '+ New Post' }),
        editId ? el('a', { href: `/admin/posts/${editId}`, text: 'Edit Post' }) : null,
        viewSlug ? el('a', { href: postPath(viewSlug), text: 'View Post' }) : null,
      ]),
      el('div', {}, [
        el('span', { text: `Howdy, ${me.name || me.user}` }),
        el('a', { href: '/auth/logout?return=/', text: 'Log out' }),
      ]),
    );
    adminbar.hidden = false;
  }

  // ---------- public site ----------
  async function loadJson(path) {
    try {
      const response = await fetch(path, { cache: 'no-cache' });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }
  const loadIndex = async () => (await loadJson('/content/index.json')) || { posts: [] };

  function sidebar(index, me) {
    const months = new Map();
    for (const post of index.posts) {
      const key = monthKey(post.publishedAt);
      months.set(key, (months.get(key) || 0) + 1);
    }
    const params = new URLSearchParams(location.search);
    return el('aside', { class: 'sidebar', 'aria-label': 'Sidebar' }, [
      el('section', { class: 'widget' }, [
        el('form', { class: 'search-form', role: 'search', action: '/', method: 'get' }, [
          el('label', { class: 'screen-reader-text', for: 'search-field', text: 'Search for:' }),
          el('input', { id: 'search-field', type: 'search', name: 's', placeholder: 'Search …', value: params.get('s') || '' }),
          el('button', { type: 'submit', text: 'Search' }),
        ]),
      ]),
      index.posts.length ? el('section', { class: 'widget' }, [
        el('h2', { class: 'widget-title', text: 'Recent Posts' }),
        el('ul', {}, index.posts.slice(0, 5).map((post) => el('li', {}, el('a', { href: postPath(post.slug), text: untitled(post.title) })))),
      ]) : null,
      months.size ? el('section', { class: 'widget' }, [
        el('h2', { class: 'widget-title', text: 'Archives' }),
        el('ul', {}, [...months].map(([key, count]) => el('li', {}, [el('a', { href: `/?m=${key}`, text: monthLabel(key) }), ` (${count})`]))),
      ]) : null,
      el('section', { class: 'widget' }, [
        el('h2', { class: 'widget-title', text: 'Meta' }),
        el('ul', {}, me.signedIn
          ? [el('li', {}, el('a', { href: '/admin', text: 'Site Admin' })), el('li', {}, el('a', { href: '/auth/logout?return=/', text: 'Log out' }))]
          : [el('li', {}, el('a', { href: `/auth/login?return=${encodeURIComponent(location.pathname)}`, text: 'Log in' }))]),
      ]),
    ]);
  }

  function publicLayout(main, index, me, { single = false } = {}) {
    document.body.classList.remove('admin');
    root.replaceChildren(el('div', { class: `site${single ? ' single' : ''}` }, [
      el('header', { class: 'site-header' }, el('div', { class: 'site-branding' }, [
        el('p', { class: 'site-title' }, el('a', { href: '/', rel: 'home', text: SITE_TITLE })),
        SITE_TAGLINE ? el('p', { class: 'site-description', text: SITE_TAGLINE }) : null,
      ])),
      el('div', { class: 'site-content' }, [
        el('main', { class: 'content-area', id: 'main' }, main),
        sidebar(index, me),
      ]),
      el('footer', { class: 'site-footer' }, [
        `© ${new Date().getFullYear()} `, el('a', { href: 'https://dliu.com', text: 'Dewei Liu' }), ` · ${SITE_TITLE}`,
      ]),
    ]));
  }

  const entryMeta = (post) => el('div', { class: 'entry-meta' }, [
    'Posted on ', el('time', { datetime: post.publishedAt, text: fmtDate(post.publishedAt) }),
    post.authorName ? ` by ${post.authorName}` : '',
  ]);

  async function homePage(me) {
    const index = await loadIndex();
    const params = new URLSearchParams(location.search);
    const search = (params.get('s') || '').trim();
    const month = /^\d{6}$/.test(params.get('m') || '') ? params.get('m') : '';
    const page = Math.max(1, parseInt(params.get('paged') || '1', 10) || 1);
    let posts = index.posts;
    let heading = null;
    if (search) {
      const words = search.toLowerCase().split(/\s+/);
      posts = posts.filter((post) => words.every((word) => `${post.title} ${post.excerpt}`.toLowerCase().includes(word)));
      heading = `Search Results for: ${search}`;
    } else if (month) {
      posts = posts.filter((post) => monthKey(post.publishedAt) === month);
      heading = `Month: ${monthLabel(month)}`;
    }
    const pages = Math.max(1, Math.ceil(posts.length / PER_PAGE));
    const shown = posts.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const pageLink = (n) => {
      const next = new URLSearchParams(params);
      if (n > 1) next.set('paged', n); else next.delete('paged');
      const query = next.toString();
      return query ? `/?${query}` : '/';
    };

    const main = [];
    if (heading) main.push(el('header', { class: 'page-header' }, el('h1', { class: 'page-title', text: heading })));
    if (!shown.length) {
      main.push(el('section', {}, [
        el('h2', { class: 'entry-title', text: 'Nothing Found' }),
        el('p', { class: 'notice-empty', text: search ? 'Sorry, nothing matched your search terms. Please try again with some different keywords.' : 'No posts yet.' }),
      ]));
    }
    for (const post of shown) {
      main.push(el('article', { class: 'entry' }, [
        el('header', {}, [
          el('h2', { class: 'entry-title' }, el('a', { href: postPath(post.slug), rel: 'bookmark', text: untitled(post.title) })),
          entryMeta(post),
        ]),
        post.cover ? el('a', { class: 'entry-cover', href: postPath(post.slug), 'aria-hidden': 'true', tabindex: '-1' }, el('img', { src: post.cover, alt: '', loading: 'lazy' })) : null,
        el('div', { class: 'entry-summary' }, [
          post.excerpt ? el('p', { text: post.excerpt }) : null,
          el('a', { class: 'more-link', href: postPath(post.slug) }, ['Continue reading', el('span', { class: 'screen-reader-text', text: ` “${untitled(post.title)}”` }), ' →']),
        ]),
      ]));
    }
    if (pages > 1) {
      main.push(el('nav', { class: 'pagination', 'aria-label': 'Posts' }, [
        page < pages ? el('a', { href: pageLink(page + 1), text: '← Older posts' }) : el('span'),
        page > 1 ? el('a', { href: pageLink(page - 1), text: 'Newer posts →' }) : el('span'),
      ]));
    }
    setTitle(heading, page > 1 ? `Page ${page}` : '', heading || page > 1 ? '' : SITE_TAGLINE);
    publicLayout(main, index, me);
    showAdminBar(me);
  }

  function notFound(index, me) {
    setTitle('Page not found');
    publicLayout([
      el('header', { class: 'page-header' }, el('h1', { class: 'page-title', text: 'Oops! That page can’t be found.' })),
      el('p', { text: 'It looks like nothing was found at this location. Maybe try a search?' }),
    ], index, me);
    showAdminBar(me);
  }

  async function postPage(me, slug) {
    const [index, post] = await Promise.all([loadIndex(), loadJson(`/content/posts/${encodeURIComponent(slug)}.json`)]);
    if (!post) return notFound(index, me);
    const content = el('div', { class: 'entry-content' }, md.render(post.body));
    // Files the post doesn't show inline: pictures as a gallery, everything else as a list.
    const unused = (post.files || []).filter((file) => !post.body.includes(file.url));
    const pictures = unused.filter((file) => isImage(file.type));
    const others = unused.filter((file) => !isImage(file.type));
    const position = index.posts.findIndex((entry) => entry.slug === post.slug);
    const older = position >= 0 ? index.posts[position + 1] : null;
    const newer = position > 0 ? index.posts[position - 1] : null;

    setTitle(untitled(post.title));
    publicLayout([
      el('article', { class: 'entry' }, [
        el('header', {}, [el('h1', { class: 'entry-title', text: untitled(post.title) }), entryMeta(post)]),
        content,
        pictures.length ? el('div', { class: 'gallery' }, pictures.map((file) => el('a', { href: file.url }, el('img', { src: file.url, alt: file.name, loading: 'lazy' })))) : null,
        others.length ? el('section', { class: 'attachments' }, [
          el('h2', { text: 'Attachments' }),
          el('ul', {}, others.map((file) => el('li', {}, [el('a', { href: file.url, text: file.name }), el('span', { class: 'size', text: ` (${fmtSize(file.size)})` })]))),
        ]) : null,
      ]),
      older || newer ? el('nav', { class: 'post-navigation', 'aria-label': 'Posts' }, [
        older ? el('div', { class: 'nav-previous' }, el('a', { href: postPath(older.slug) }, [el('span', { class: 'meta-nav', text: 'Previous Post' }), untitled(older.title)])) : null,
        newer ? el('div', { class: 'nav-next' }, el('a', { href: postPath(newer.slug) }, [el('span', { class: 'meta-nav', text: 'Next Post' }), untitled(newer.title)])) : null,
      ]) : null,
    ], index, me, { single: true });
    showAdminBar(me, { editId: post.id });
  }

  // ---------- admin ----------
  function adminLayout(current, main) {
    document.body.classList.add('admin');
    const link = (href, text, key, cls) => el('li', { class: cls }, el('a', { href, text, class: current === key ? 'current' : null }));
    root.replaceChildren(el('div', { class: 'wp-wrap' }, [
      el('nav', { class: 'admin-menu', 'aria-label': 'Admin menu' }, el('ul', {}, [
        link('/admin', 'Posts', 'posts-menu'),
        link('/admin', 'All Posts', 'posts', 'sub'),
        link('/admin/new', 'Add New', 'new', 'sub'),
        link('/', 'View Site', 'site'),
      ])),
      el('main', { class: 'admin-main' }, main),
    ]));
  }

  function notice(container, message, { error = false, link } = {}) {
    container.replaceChildren(message ? el('div', { class: `notice${error ? ' error' : ''}`, role: error ? 'alert' : 'status' }, [
      el('span', { text: message }), link ? ' ' : null, link ? el('a', { href: link.href, text: link.text }) : null,
    ]) : '');
  }

  function toLogin() {
    location.replace(`/auth/login?return=${encodeURIComponent(location.pathname + location.search)}`);
  }

  async function postsList(me) {
    setTitle('Posts');
    const notices = el('div');
    const { posts } = await api('GET', '/api/posts');
    const filter = new URLSearchParams(location.search).get('status');
    const shown = filter ? posts.filter((post) => post.status === filter) : posts;
    const count = (status) => posts.filter((post) => !status || post.status === status).length;
    const tab = (status, label) => el('li', {}, [
      el('a', { href: status ? `/admin?status=${status}` : '/admin', class: (filter || '') === status ? 'current' : null }, [label, ' ', el('span', { class: 'count', text: `(${count(status)})` })]),
    ]);

    const rows = shown.map((post) => {
      const edit = `/admin/posts/${post.id}`;
      const remove = async () => {
        if (!confirm(`Move “${untitled(post.title)}” to the trash? This deletes the post and its files permanently.`)) return;
        try {
          await api('DELETE', `/api/posts/${post.id}`);
          await postsList(me);
          notice(root.querySelector('.admin-main > div'), '1 post moved to the Trash.');
        } catch (error) {
          notice(notices, error.message, { error: true });
        }
      };
      return el('tr', {}, [
        el('td', {}, [
          el('a', { class: 'row-title', href: edit, text: untitled(post.title) }),
          post.status === 'draft' ? el('span', { class: 'post-state', text: ' — Draft' }) : null,
          el('div', { class: 'row-actions' }, [
            el('a', { href: edit, text: 'Edit' }),
            post.status === 'published' ? [' | ', el('a', { href: postPath(post.slug), text: 'View' })] : null,
            ' | ',
            el('button', { type: 'button', class: 'trash', text: 'Trash', onclick: remove }),
          ].flat()),
        ]),
        el('td', { class: 'col-author', text: post.authorName }),
        el('td', { class: 'col-status', text: post.status === 'published' ? 'Published' : 'Draft' }),
        el('td', { class: 'col-date' }, post.status === 'published'
          ? ['Published', el('br'), fmtDateTime(post.publishedAt)]
          : ['Last Modified', el('br'), fmtDateTime(post.updatedAt)]),
      ]);
    });

    adminLayout('posts', [
      el('h1', { text: 'Posts' }),
      el('a', { class: 'page-title-action', href: '/admin/new', text: 'Add New Post' }),
      notices,
      el('ul', { class: 'subsubsub' }, [tab('', 'All'), ' | ', tab('published', 'Published'), ' | ', tab('draft', 'Drafts')]),
      el('table', { class: 'wp-list-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', { scope: 'col', text: 'Title' }),
          el('th', { scope: 'col', class: 'col-author', text: 'Author' }),
          el('th', { scope: 'col', class: 'col-status', text: 'Status' }),
          el('th', { scope: 'col', class: 'col-date', text: 'Date' }),
        ])),
        el('tbody', {}, rows.length ? rows : el('tr', {}, el('td', { colspan: '4', text: 'No posts found.' }))),
      ]),
    ]);
    showAdminBar(me);
  }

  async function newPost() {
    const post = await api('POST', '/api/posts', {});
    location.replace(`/admin/posts/${post.id}`);
  }

  async function editor(me, id) {
    let post = await api('GET', `/api/posts/${id}`);
    let dirty = false;
    let uploading = 0;
    let pendingSlug = null;

    const notices = el('div');
    const title = el('input', { class: 'title-input', id: 'title', value: post.title, placeholder: 'Add title', 'aria-label': 'Title', maxlength: '200' });
    const body = el('textarea', { id: 'body', 'aria-label': 'Post content (Markdown)', placeholder: 'Write your post… Markdown works: **bold**, *italic*, ## headings, - lists, [links](https://…). Drop or paste pictures here.' });
    body.value = post.body;
    const preview = el('div', { class: 'preview entry-content', hidden: true });
    const wordCount = el('span');
    const savedAt = el('span');
    const permalink = el('div', { class: 'permalink' });
    const publishBox = el('div', { class: 'postbox' });
    const fileList = el('ul', { class: 'file-list' });
    const mediaInput = el('input', { type: 'file', multiple: true, hidden: true });
    const attachInput = el('input', { type: 'file', multiple: true, class: 'screen-reader-text', id: 'attach-files' });

    const setDirty = () => {
      dirty = true;
      wordCount.textContent = `Word count: ${(body.value.match(/[\p{L}\p{N}]+/gu) || []).length}`;
    };
    setDirty();
    dirty = false;

    function siteUrl(slug) {
      return `${location.origin}${postPath(slug)}`;
    }

    function renderPermalink() {
      const slug = pendingSlug ?? post.slug;
      const editButton = el('button', { type: 'button', class: 'wp-button', text: 'Edit', onclick: () => {
        const input = el('input', { value: slug || '', 'aria-label': 'Permalink', placeholder: 'my-post' });
        permalink.replaceChildren(
          el('b', { text: 'Permalink:' }), ` ${location.origin}/posts/`, input,
          el('button', { type: 'button', class: 'wp-button', text: 'OK', onclick: () => { pendingSlug = input.value.trim() || null; if (pendingSlug) setDirty(); renderPermalink(); } }),
          el('button', { type: 'button', class: 'link-delete', text: 'Cancel', onclick: renderPermalink }),
        );
        input.focus();
      } });
      if (!slug) {
        permalink.replaceChildren(el('span', { text: 'The permalink is made from the title when you publish.' }), editButton);
      } else {
        const label = post.status === 'published' && !pendingSlug ? el('a', { href: postPath(slug), text: siteUrl(slug) }) : el('span', { text: siteUrl(slug) });
        permalink.replaceChildren(el('b', { text: 'Permalink:' }), label, editButton);
        if (pendingSlug) permalink.append(el('em', { text: '(saved when you save the post)' }));
      }
    }

    function renderPublishBox() {
      const published = post.status === 'published';
      publishBox.replaceChildren(
        el('h2', { text: 'Publish' }),
        el('div', { class: 'inside' }, [
          el('div', { class: 'minor-actions' }, [
            published
              ? el('button', { type: 'button', class: 'wp-button', text: 'Switch to Draft', onclick: () => save('draft') })
              : el('button', { type: 'button', class: 'wp-button', text: 'Save Draft', onclick: () => save('draft') }),
            el('button', { type: 'button', class: 'wp-button', text: 'Preview', onclick: () => showTab('preview') }),
          ]),
          el('p', { class: 'misc-pub' }, ['Status: ', el('b', { text: published ? 'Published' : 'Draft' })]),
          published ? el('p', { class: 'misc-pub' }, ['Published on: ', el('b', { text: fmtDateTime(post.publishedAt) })]) : null,
          el('p', { class: 'misc-pub' }, ['Last saved: ', el('b', { text: fmtDateTime(post.updatedAt) })]),
        ]),
        el('div', { class: 'major-actions' }, [
          el('button', { type: 'button', class: 'link-delete', text: 'Move to Trash', onclick: trash }),
          el('button', { type: 'button', class: 'wp-button primary', text: published ? 'Update' : 'Publish', onclick: () => save('published') }),
        ]),
      );
    }

    function snippet(file) {
      const label = file.name.replace(/[[\]\\]/g, '');
      return isImage(file.type) ? `![${label.replace(/\.[^.]+$/, '')}](${file.url})` : `[${label}](${file.url})`;
    }

    function insertAtCursor(text, { block = false } = {}) {
      const start = body.selectionStart;
      const end = body.selectionEnd;
      let insert = text;
      if (block) {
        const before = body.value.slice(0, start);
        const after = body.value.slice(end);
        if (before && !before.endsWith('\n\n')) insert = (before.endsWith('\n') ? '\n' : '\n\n') + insert;
        if (!after.startsWith('\n\n')) insert += after.startsWith('\n') ? '\n' : '\n\n';
      }
      body.focus();
      body.setRangeText(insert, start, end, 'end');
      setDirty();
      if (!preview.hidden) renderPreview();
    }

    // Rows for uploads in progress (or failed) stay below the saved files.
    function renderFiles() {
      const files = post.files || [];
      const pending = [...fileList.querySelectorAll('li.pending')];
      fileList.replaceChildren(...files.map((file) => el('li', {}, [
        isImage(file.type) ? el('img', { class: 'thumb', src: file.url, alt: '' }) : el('span', { class: 'thumb', text: (file.name.split('.').pop() || 'file').slice(0, 4) }),
        el('div', {}, [
          el('a', { class: 'name', href: file.url, target: '_blank', rel: 'noopener', text: file.name }),
          el('div', { class: 'actions' }, [
            el('span', { text: fmtSize(file.size) }),
            el('button', { type: 'button', text: 'Insert', onclick: () => insertAtCursor(snippet(file), { block: true }) }),
            el('button', { type: 'button', class: 'remove', text: 'Remove', onclick: () => removeFile(file) }),
          ]),
        ]),
      ])), ...pending);
    }

    function putFile(url, headers, file, progress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        for (const [name, value] of Object.entries(headers || {})) xhr.setRequestHeader(name, value);
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress.value = event.loaded / event.total; };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
        xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
        xhr.send(file);
      });
    }

    async function uploadFiles(list, { insert = false } = {}) {
      for (const file of [...list]) {
        const progress = el('progress', { max: '1', value: '0' });
        const row = el('li', { class: 'pending' }, [el('span', { class: 'thumb', text: '…' }), el('div', {}, [el('span', { class: 'name', text: file.name }), progress])]);
        fileList.append(row);
        uploading += 1;
        try {
          if (!file.size) throw new Error('File is empty');
          if (file.size > MAX_FILE_BYTES) throw new Error(`Files can be at most ${MAX_FILE_BYTES / 1048576} MB`);
          const ticket = await api('POST', `/api/posts/${post.id}/files`, { name: file.name, size: file.size, type: file.type || 'application/octet-stream' });
          await putFile(ticket.uploadUrl, ticket.uploadHeaders, file, progress);
          const updated = await api('PUT', `/api/posts/${post.id}/files/${ticket.fileId}`, { name: file.name });
          // Keep unsaved title and text; take the server's file list.
          post = { ...post, files: updated.files, updatedAt: updated.updatedAt };
          row.remove();
          renderFiles();
          if (insert) insertAtCursor(snippet(updated.files.find((f) => f.id === ticket.fileId)), { block: true });
        } catch (error) {
          row.replaceChildren(el('span', { class: 'thumb', text: '!' }), el('div', {}, [el('span', { class: 'name', text: file.name }), el('div', { class: 'failed', text: error.message })]));
          if (error.status === 401) toLogin();
        } finally {
          uploading -= 1;
        }
      }
    }

    async function removeFile(file) {
      const used = body.value.includes(file.url);
      if (!confirm(`Remove ${file.name}?${used ? ' It is still used in the post text.' : ''}`)) return;
      try {
        const updated = await api('DELETE', `/api/posts/${post.id}/files/${file.id}`);
        post = { ...post, files: updated.files, updatedAt: updated.updatedAt };
        renderFiles();
      } catch (error) {
        notice(notices, error.message, { error: true });
      }
    }

    async function save(status) {
      const buttons = [...root.querySelectorAll('.postbox button')];
      buttons.forEach((b) => { b.disabled = true; });
      const wasPublished = post.status === 'published';
      const payload = { title: title.value, body: body.value, status };
      if (pendingSlug) payload.slug = pendingSlug;
      try {
        post = await api('PUT', `/api/posts/${post.id}`, payload);
        pendingSlug = null;
        dirty = false;
        const view = { href: postPath(post.slug), text: 'View post' };
        if (status === 'published') notice(notices, wasPublished ? 'Post updated.' : 'Post published.', { link: view });
        else notice(notices, wasPublished ? 'Post reverted to draft.' : 'Draft saved.');
        savedAt.textContent = `Saved at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
        renderPublishBox();
        renderPermalink();
        showAdminBar(me, { viewSlug: post.status === 'published' ? post.slug : null });
      } catch (error) {
        notice(notices, error.message, { error: true });
        if (error.status === 401) toLogin();
      } finally {
        buttons.forEach((b) => { b.disabled = false; });
      }
    }

    async function trash() {
      if (!confirm('Move this post to the trash? This deletes the post and its files permanently.')) return;
      try {
        await api('DELETE', `/api/posts/${post.id}`);
        dirty = false;
        location.replace('/admin');
      } catch (error) {
        notice(notices, error.message, { error: true });
      }
    }

    // ---------- toolbar ----------
    function wrap(before, after = before, placeholder = 'text') {
      const start = body.selectionStart;
      const end = body.selectionEnd;
      const selected = body.value.slice(start, end) || placeholder;
      body.focus();
      body.setRangeText(`${before}${selected}${after}`, start, end, 'select');
      body.setSelectionRange(start + before.length, start + before.length + selected.length);
      setDirty();
    }
    function prefixLines(prefix) {
      const start = body.value.lastIndexOf('\n', body.selectionStart - 1) + 1;
      let end = body.value.indexOf('\n', body.selectionEnd);
      if (end < 0) end = body.value.length;
      const lines = body.value.slice(start, end).split('\n');
      const text = lines.map((line, i) => `${typeof prefix === 'function' ? prefix(i) : prefix}${line}`).join('\n');
      body.focus();
      body.setRangeText(text, start, end, 'end');
      setDirty();
    }
    function addLink() {
      const url = prompt('Link URL', 'https://');
      if (url && url !== 'https://') wrap('[', `](${url})`, 'link text');
    }
    const tool = (label, title, action, cls) => el('button', { type: 'button', class: cls, title, 'aria-label': title, text: label, onclick: action });

    function renderPreview() {
      preview.replaceChildren(el('h1', { class: 'entry-title', text: untitled(title.value) }), md.render(body.value));
    }
    const writeTab = el('button', { type: 'button', role: 'tab', text: 'Write', onclick: () => showTab('write') });
    const previewTab = el('button', { type: 'button', role: 'tab', text: 'Preview', onclick: () => showTab('preview') });
    const toolbar = el('div', { class: 'toolbar' }, [
      tool('B', 'Bold', () => wrap('**'), 'b'),
      tool('I', 'Italic', () => wrap('*'), 'i'),
      tool('H2', 'Heading', () => prefixLines('## ')),
      tool('H3', 'Subheading', () => prefixLines('### ')),
      tool('🔗', 'Insert link', addLink),
      tool('❝', 'Quote', () => prefixLines('> ')),
      tool('•', 'Bulleted list', () => prefixLines('- ')),
      tool('1.', 'Numbered list', () => prefixLines((i) => `${i + 1}. `)),
      tool('</>', 'Code', () => wrap('`')),
      tool('—', 'Horizontal line', () => insertAtCursor('---', { block: true })),
    ]);
    function showTab(name) {
      const write = name === 'write';
      writeTab.setAttribute('aria-selected', String(write));
      previewTab.setAttribute('aria-selected', String(!write));
      body.hidden = !write;
      toolbar.hidden = !write;
      preview.hidden = write;
      if (!write) renderPreview();
      else body.focus();
    }

    // ---------- events ----------
    title.addEventListener('input', setDirty);
    body.addEventListener('input', setDirty);
    mediaInput.addEventListener('change', () => { uploadFiles(mediaInput.files, { insert: true }); mediaInput.value = ''; });
    attachInput.addEventListener('change', () => { uploadFiles(attachInput.files); attachInput.value = ''; });
    body.addEventListener('paste', (event) => {
      const files = event.clipboardData && event.clipboardData.files;
      if (files && files.length) {
        event.preventDefault();
        uploadFiles(files, { insert: true });
      }
    });
    const dropTarget = (node, options) => {
      node.addEventListener('dragover', (event) => { event.preventDefault(); node.classList.add('dragover'); });
      node.addEventListener('dragleave', () => node.classList.remove('dragover'));
      node.addEventListener('drop', (event) => {
        event.preventDefault();
        node.classList.remove('dragover');
        if (event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files, options);
      });
    };
    dropTarget(body, { insert: true });
    const dropzone = el('label', { class: 'dropzone', for: 'attach-files' }, ['Drop files to upload', el('br'), 'or ', el('u', { text: 'select files' })]);
    dropTarget(dropzone, {});
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        save(post.status);
      }
    });
    window.addEventListener('beforeunload', (event) => {
      if (dirty || uploading) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    setTitle('Edit Post');
    adminLayout(post.createdAt === post.updatedAt && !post.title ? 'new' : 'posts', [
      el('h1', { text: 'Edit Post' }),
      el('a', { class: 'page-title-action', href: '/admin/new', text: 'Add New Post' }),
      notices,
      el('div', { class: 'post-columns' }, [
        el('div', {}, [
          title,
          permalink,
          el('div', { class: 'editor' }, [
            el('div', { class: 'editor-tools' }, [
              el('div', {}, [el('button', { type: 'button', class: 'wp-button', text: '📎 Add Media', onclick: () => mediaInput.click() }), mediaInput]),
              el('div', { class: 'editor-tabs', role: 'tablist' }, [writeTab, previewTab]),
            ]),
            toolbar,
            body,
            preview,
            el('div', { class: 'editor-status' }, [wordCount, savedAt]),
          ]),
        ]),
        el('div', {}, [
          publishBox,
          el('div', { class: 'postbox' }, [
            el('h2', { text: 'Attachments' }),
            el('div', { class: 'inside' }, [attachInput, dropzone, fileList]),
          ]),
        ]),
      ]),
    ]);
    renderPermalink();
    renderPublishBox();
    renderFiles();
    showTab('write');
    if (!post.title) title.focus();
    showAdminBar(me, { viewSlug: post.status === 'published' ? post.slug : null });
  }

  async function adminPage() {
    const me = await whoAmI({ force: true });
    if (me.configured === false) {
      adminLayout('', [el('h1', { text: 'Sign-in is not configured' }), el('p', { text: 'Run "make set-secrets" to store the Microsoft Entra app settings.' })]);
      return;
    }
    if (!me.signedIn) return toLogin();
    const path = location.pathname.replace(/\/+$/, '');
    try {
      if (path === '/admin') return await postsList(me);
      if (path === '/admin/new') return await newPost();
      const match = /^\/admin\/posts\/([A-Za-z0-9_-]{12})$/.exec(path);
      if (match) return await editor(me, match[1]);
      adminLayout('', [el('h1', { text: 'Page not found' }), el('p', {}, el('a', { href: '/admin', text: 'Back to Posts' }))]);
    } catch (error) {
      if (error.status === 401) return toLogin();
      adminLayout('', [el('h1', { text: error.status === 404 ? 'Post not found' : 'Something went wrong' }), el('p', { text: error.message }), el('p', {}, el('a', { href: '/admin', text: 'Back to Posts' }))]);
    }
    return undefined;
  }

  // ---------- routing ----------
  async function start() {
    const path = location.pathname;
    if (path === '/admin' || path.startsWith('/admin/')) return adminPage();
    const me = await whoAmI();
    if (path === '/' || path === '/index.html') return homePage(me);
    const match = /^\/posts\/([^/]+)\/?$/.exec(path);
    if (match) {
      let slug;
      try { slug = decodeURIComponent(match[1]); } catch { slug = ''; }
      return postPage(me, slug.toLowerCase());
    }
    return notFound(await loadIndex(), me);
  }

  start().catch((error) => {
    console.error(error);
    root.replaceChildren(el('p', { class: 'loading', text: 'Something went wrong. Please reload the page.' }));
  });
})();
