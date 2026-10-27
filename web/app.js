'use strict';

// Public pages read static JSON (/content/index.json, /content/posts/<id>.json) straight from CloudFront.
// Only the admin pages (/admin…) and signed-in authors call the API.
(() => {
  const SITE_TITLE = 'Dewei Blog';
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const root = document.getElementById('root');
  const nav = document.getElementById('nav');
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

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const monthKey = (iso) => String(iso || '').slice(0, 7).replace('-', '');
  const monthLabel = (key) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4)) - 1, 1))
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  // Posts live at /<post id>, e.g. /2026102701.
  const postPath = (id) => `/${id}`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const fmtSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const isImage = (type) => /^image\/(png|jpe?g|gif|webp|avif)$/.test(type || '');
  const fileExt = (name) => ((/\.([A-Za-z0-9]{1,5})$/.exec(name) || [])[1] || 'file').toUpperCase();
  const untitled = (title) => title || '(no title)';
  const setTitle = (...parts) => { document.title = [...parts.filter(Boolean), SITE_TITLE].join(' · '); };
  const signInUrl = () => `/auth/login?return=${encodeURIComponent(location.pathname + location.search)}`;

  function notice(container, message, { error = false, link } = {}) {
    container.replaceChildren(message ? el('div', { class: `notice${error ? ' error' : ''}`, role: error ? 'alert' : 'status' }, [
      el('span', { text: message }), link ? ' ' : null, link ? el('a', { href: link.href, text: link.text }) : null,
    ]) : '');
  }

  function page(main, { wide = false } = {}) {
    root.className = wide ? 'wide' : '';
    root.replaceChildren(...[].concat(main).filter(Boolean));
  }

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

  // Signed in, the header is crowded on phones, so the button is left out there (the footer links to Docs too).
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
    a.className = signedIn ? 'button docs-link hide-narrow' : 'button docs-link';
    a.href = '/docs';
    a.title = 'How this blog works';
    a.setAttribute('aria-label', 'Docs');
    a.append(svg, label);
    if (location.pathname.replace(/\/$/, '') === '/docs') a.setAttribute('aria-current', 'page');
    return a;
  }

  // Header buttons: Docs for everyone; a clear Sign in for readers; New post, Posts and Sign out for the author.
  function renderNav(me, { editId } = {}) {
    if (!me.signedIn) {
      nav.replaceChildren(docsButton(), el('a', { class: 'button primary sign-in', href: signInUrl(), text: 'Sign in' }));
      return;
    }
    nav.replaceChildren(...[
      docsButton(true),
      editId ? el('a', { class: 'button', href: `/admin/posts/${editId}`, text: 'Edit' }) : null,
      el('a', { class: 'button', href: '/admin', text: 'Posts' }),
      el('a', { class: 'button primary', href: '/admin/new', text: '＋ New post' }),
      el('a', { class: 'button', href: '/auth/logout?return=/', text: 'Sign out' }),
    ].filter(Boolean));
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

  async function homePage(me) {
    const index = await loadIndex();
    const params = new URLSearchParams(location.search);
    const month = /^\d{6}$/.test(params.get('m') || '') ? params.get('m') : '';
    const search = (params.get('s') || '').trim().toLowerCase();
    let posts = index.posts;
    let heading = 'Posts';
    if (month) {
      posts = posts.filter((post) => monthKey(post.publishedAt) === month);
      heading = monthLabel(month);
    } else if (search) {
      posts = posts.filter((post) => search.split(/\s+/).every((word) => `${post.title} ${post.excerpt}`.toLowerCase().includes(word)));
      heading = `Posts matching “${params.get('s').trim()}”`;
    }
    setTitle(month || search ? heading : '');
    renderNav(me);
    page([
      el('div', { class: 'row spread head' }, [
        el('h1', { text: heading }),
        month || search ? el('a', { href: '/', text: 'All posts' }) : el('span', { class: 'muted', text: posts.length ? plural(posts.length, 'post') : '' }),
      ]),
      posts.length
        ? el('ul', { class: 'posts' }, posts.map((post) => el('li', {}, [
          el('a', { class: 'title', href: postPath(post.id), text: untitled(post.title) }),
          el('time', { datetime: post.publishedAt, text: fmtDate(post.publishedAt) }),
        ])))
        : el('p', { class: 'empty', text: 'No posts yet.' }),
    ]);
  }

  function notFound(me) {
    setTitle('Not found');
    renderNav(me);
    page(el('div', { class: 'empty' }, [el('h1', { text: 'Page not found' }), el('p', {}, el('a', { href: '/', text: 'See all posts' }))]));
  }

  async function postPage(me, id) {
    const post = await loadJson(`/content/posts/${id}.json`);
    if (!post) return notFound(me);
    // Files the post doesn't show inline: pictures as a gallery, everything else as a list.
    const unused = (post.files || []).filter((file) => !post.body.includes(file.url));
    const pictures = unused.filter((file) => isImage(file.type));
    const others = unused.filter((file) => !isImage(file.type));

    setTitle(untitled(post.title));
    renderNav(me, { editId: post.id });
    page(el('article', { class: 'article' }, [
      el('a', { class: 'back', href: '/', text: '← All posts' }),
      el('h1', { text: untitled(post.title) }),
      el('p', { class: 'meta' }, [el('time', { datetime: post.publishedAt, text: fmtDate(post.publishedAt) }), post.authorName ? ` · ${post.authorName}` : '']),
      el('div', { class: 'prose' }, md.render(post.body)),
      pictures.length ? el('div', { class: 'gallery' }, pictures.map((file) => el('a', { href: file.url }, el('img', { src: file.url, alt: file.name, loading: 'lazy' })))) : null,
      others.length ? el('section', { class: 'attachments' }, [
        el('h2', { text: 'Attachments' }),
        el('ul', {}, others.map((file) => el('li', {}, el('a', { href: file.url }, [
          el('span', { class: 'ext', text: fileExt(file.name) }),
          el('span', { class: 'name', text: file.name }),
          el('span', { class: 'size', text: fmtSize(file.size) }),
        ])))),
      ]) : null,
    ]));
    return undefined;
  }

  // ---------- admin ----------
  function toLogin() {
    location.replace(signInUrl());
  }

  async function postsList(me, flash) {
    setTitle('Posts');
    const notices = el('div');
    const { posts } = await api('GET', '/api/posts');

    const rows = posts.map((post) => {
      const edit = `/admin/posts/${post.id}`;
      const published = post.status === 'published';
      const remove = async () => {
        if (!confirm(`Delete “${untitled(post.title)}”? This permanently deletes the post and its files.`)) return;
        try {
          await api('DELETE', `/api/posts/${post.id}`);
          await postsList(me, 'Post deleted.');
        } catch (error) {
          notice(notices, error.message, { error: true });
        }
      };
      return el('li', {}, [
        el('div', { class: 'info' }, [
          el('a', { class: 'title', href: edit, text: untitled(post.title) }),
          el('div', { class: 'meta' }, [
            el('span', { class: `pill ${post.status}`, text: published ? 'Published' : 'Draft' }),
            el('span', { text: published ? fmtDateTime(post.publishedAt) : `Edited ${fmtDateTime(post.updatedAt)}` }),
            el('span', { text: post.id }),
          ]),
        ]),
        el('div', { class: 'actions' }, [
          el('a', { class: 'button small', href: edit, text: 'Edit' }),
          published ? el('a', { class: 'button small', href: postPath(post.id), text: 'View' }) : null,
          el('button', { type: 'button', class: 'small danger', text: 'Delete', onclick: remove }),
        ]),
      ]);
    });

    renderNav(me);
    page([
      el('div', { class: 'row spread head' }, [el('h1', { text: 'All posts' }), el('span', { class: 'muted', text: `${posts.filter((p) => p.status === 'published').length} published · ${plural(posts.filter((p) => p.status !== 'published').length, 'draft')}` })]),
      notices,
      rows.length ? el('ul', { class: 'posts admin' }, rows) : el('div', { class: 'empty' }, [
        el('p', { text: 'No posts yet.' }),
        el('a', { class: 'button primary', href: '/admin/new', text: 'Write your first post' }),
      ]),
    ]);
    if (flash) notice(notices, flash);
  }

  async function newPost() {
    const post = await api('POST', '/api/posts', {});
    location.replace(`/admin/posts/${post.id}`);
  }

  async function editor(me, id) {
    let post = await api('GET', `/api/posts/${id}`);
    let dirty = false;
    let uploading = 0;

    const notices = el('div');
    const title = el('input', { type: 'text', class: 'title-input', id: 'title', value: post.title, placeholder: 'Title', 'aria-label': 'Title', maxlength: '200' });
    const body = el('textarea', { id: 'body', 'aria-label': 'Post text (Markdown)', placeholder: 'Write your post in Markdown…\n\nDrop or paste pictures here.' });
    body.value = post.body;
    const preview = el('div', { class: 'preview prose', hidden: true });
    const wordCount = el('span');
    const savedAt = el('span');
    const permalink = el('div', { class: 'permalink' });
    const publishBox = el('section', { class: 'panel publish' });
    const fileList = el('ul', { class: 'files' });
    const mediaInput = el('input', { type: 'file', multiple: true, hidden: true });
    const attachInput = el('input', { type: 'file', multiple: true, class: 'screen-reader-text', id: 'attach-files' });

    const setDirty = () => {
      dirty = true;
      wordCount.textContent = `${(body.value.match(/[\p{L}\p{N}]+/gu) || []).length} words`;
    };
    setDirty();
    dirty = false;

    function renderPermalink() {
      const url = `${location.origin}${postPath(post.id)}`;
      const published = post.status === 'published';
      permalink.replaceChildren(...[
        el('span', { text: 'Link: ' }),
        published ? el('a', { href: postPath(post.id), text: url }) : el('span', { text: url }),
        published ? null : el('em', { text: ' (works once published)' }),
      ].filter(Boolean));
    }

    function renderPublishBox() {
      const published = post.status === 'published';
      publishBox.replaceChildren(
        el('h2', { text: 'Publish' }),
        el('dl', { class: 'facts' }, [
          el('dt', { text: 'Status' }), el('dd', {}, el('span', { class: `pill ${post.status}`, text: published ? 'Published' : 'Draft' })),
          published ? [el('dt', { text: 'Published' }), el('dd', { text: fmtDateTime(post.publishedAt) })] : null,
          el('dt', { text: 'Last saved' }), el('dd', { text: fmtDateTime(post.updatedAt) }),
          el('dt', { text: 'Post ID' }), el('dd', { text: post.id }),
        ].flat()),
        el('div', { class: 'publish-actions' }, [
          el('button', { type: 'button', class: 'primary', text: published ? 'Update' : 'Publish', onclick: () => save('published') }),
          published
            ? el('button', { type: 'button', text: 'Unpublish (back to draft)', onclick: () => save('draft') })
            : el('button', { type: 'button', text: 'Save draft', onclick: () => save('draft') }),
          published ? el('a', { class: 'button', href: postPath(post.id), text: 'View post' }) : null,
          el('button', { type: 'button', class: 'link danger delete', text: 'Delete post', onclick: trash }),
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
        isImage(file.type) ? el('img', { class: 'thumb', src: file.url, alt: '' }) : el('span', { class: 'thumb', text: fileExt(file.name).slice(0, 4) }),
        el('div', {}, [
          el('a', { class: 'name', href: file.url, target: '_blank', rel: 'noopener', text: file.name }),
          el('div', { class: 'file-actions' }, [
            el('span', { text: fmtSize(file.size) }),
            el('button', { type: 'button', class: 'link', text: 'Insert', onclick: () => insertAtCursor(snippet(file), { block: true }) }),
            el('button', { type: 'button', class: 'link danger', text: 'Remove', onclick: () => removeFile(file) }),
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
      const buttons = [...publishBox.querySelectorAll('button')];
      buttons.forEach((b) => { b.disabled = true; });
      const wasPublished = post.status === 'published';
      const payload = { title: title.value, body: body.value, status };
      try {
        post = await api('PUT', `/api/posts/${post.id}`, payload);
        dirty = false;
        const view = { href: postPath(post.id), text: 'View post' };
        if (status === 'published') notice(notices, wasPublished ? 'Post updated.' : 'Post published.', { link: view });
        else notice(notices, wasPublished ? 'Post moved back to drafts.' : 'Draft saved.');
        savedAt.textContent = `Saved at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
        renderPublishBox();
        renderPermalink();
      } catch (error) {
        notice(notices, error.message, { error: true });
        if (error.status === 401) toLogin();
        buttons.forEach((b) => { b.disabled = false; });
      }
    }

    async function trash() {
      if (!confirm('Delete this post? This permanently deletes the post and its files.')) return;
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
    const tool = (label, name, action, cls) => el('button', { type: 'button', class: cls, title: name, 'aria-label': name, text: label, onclick: action });

    function renderPreview() {
      preview.replaceChildren(el('h1', { text: untitled(title.value) }), md.render(body.value));
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
      tool('🖼 Picture or file', 'Insert a picture or file', () => mediaInput.click()),
    ]);
    function showTab(name) {
      const write = name === 'write';
      writeTab.setAttribute('aria-selected', String(write));
      previewTab.setAttribute('aria-selected', String(!write));
      body.hidden = !write;
      toolbar.style.visibility = write ? '' : 'hidden';
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
      node.addEventListener('dragover', (event) => { event.preventDefault(); node.classList.add('over'); });
      node.addEventListener('dragleave', () => node.classList.remove('over'));
      node.addEventListener('drop', (event) => {
        event.preventDefault();
        node.classList.remove('over');
        if (event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files, options);
      });
    };
    dropTarget(body, { insert: true });
    const dropzone = el('label', { class: 'drop', for: 'attach-files' }, ['Drop files here or ', el('u', { text: 'choose files' })]);
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

    setTitle(post.title ? `Edit: ${post.title}` : 'New post');
    renderNav(me);
    page([
      el('div', { class: 'row spread head' }, [el('h1', { text: post.createdAt === post.updatedAt && !post.title ? 'New post' : 'Edit post' }), el('a', { href: '/admin', text: '← All posts' })]),
      notices,
      el('div', { class: 'editor-grid' }, [
        el('div', {}, [
          title,
          permalink,
          el('div', { class: 'editor' }, [
            el('div', { class: 'editor-bar' }, [toolbar, el('div', { class: 'tabs', role: 'tablist' }, [writeTab, previewTab]), mediaInput]),
            body,
            preview,
            el('div', { class: 'editor-status' }, [wordCount, savedAt]),
          ]),
        ]),
        el('div', {}, [
          publishBox,
          el('section', { class: 'panel' }, [
            el('h2', { text: 'Files' }),
            el('p', { class: 'muted small', text: 'Pictures and files shown at the end of the post, unless inserted into the text.' }),
            attachInput, dropzone, fileList,
          ]),
        ]),
      ]),
    ], { wide: true });
    renderPermalink();
    renderPublishBox();
    renderFiles();
    showTab('write');
    if (!post.title) title.focus();
  }

  async function adminPage() {
    const me = await whoAmI({ force: true });
    if (me.configured === false) {
      renderNav(me);
      page([el('h1', { text: 'Sign-in is not configured' }), el('p', { text: 'Run "make set-secrets" to store the Microsoft Entra app settings.' })]);
      return;
    }
    if (!me.signedIn) return toLogin();
    const path = location.pathname.replace(/\/+$/, '');
    try {
      if (path === '/admin') return await postsList(me);
      if (path === '/admin/new') return await newPost();
      const match = /^\/admin\/posts\/(\d{10})$/.exec(path);
      if (match) return await editor(me, match[1]);
      renderNav(me);
      page([el('h1', { text: 'Page not found' }), el('p', {}, el('a', { href: '/admin', text: 'Back to all posts' }))]);
    } catch (error) {
      if (error.status === 401) return toLogin();
      renderNav(me);
      page([el('h1', { text: error.status === 404 ? 'Post not found' : 'Something went wrong' }), el('p', { text: error.message }), el('p', {}, el('a', { href: '/admin', text: 'Back to all posts' }))]);
    }
    return undefined;
  }

  // ---------- routing ----------
  async function start() {
    const path = location.pathname;
    if (path === '/admin' || path.startsWith('/admin/')) return adminPage();
    const me = await whoAmI();
    if (path === '/' || path === '/index.html') return homePage(me);
    const match = /^\/(\d{10})\/?$/.exec(path);
    if (match) return postPage(me, match[1]);
    return notFound(me);
  }

  start().catch((error) => {
    console.error(error);
    root.replaceChildren(el('p', { class: 'empty', text: 'Something went wrong. Please reload the page.' }));
  });
})();
