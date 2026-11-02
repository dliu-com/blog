'use strict';

// Public pages read static JSON (/content/index.json, /content/posts/<id>.json) straight from CloudFront.
// Only the admin pages (/admin…), signed-in authors and reactions call the API.
// Text is in Chinese or English (web/i18n.js); switching language redraws the current page in place.
(() => {
  const { t, locale, translateError } = window.BlogI18n;
  const tr = (pair) => t(pair[0], pair[1]);
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
      const error = new Error(translateError(data.error) || t(`请求失败（${response.status}）`, `Request failed (${response.status})`));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const monthKey = (iso) => String(iso || '').slice(0, 7).replace('-', '');
  const monthLabel = (key) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4)) - 1, 1))
    .toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  // Posts live at /<post id>, e.g. /2026102701.
  const postPath = (id) => `/${id}`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const postCount = (n) => t(`${n} 篇文章`, plural(n, 'post'));
  const fmtSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const isImage = (type) => /^image\/(png|jpe?g|gif|webp|avif)$/.test(type || '');
  const fileExt = (name) => ((/\.([A-Za-z0-9]{1,5})$/.exec(name) || [])[1] || 'file').toUpperCase();
  const untitled = (title) => title || t('（无标题）', '(no title)');
  const setTitle = (...parts) => { document.title = [...parts.filter(Boolean), t('DL 博客', 'DL blog')].join(' · '); };
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
    label.textContent = t('文档', 'Docs');
    const a = document.createElement('a');
    a.className = signedIn ? 'button docs-link icon-narrow' : 'button docs-link';
    a.href = '/docs';
    a.title = t('这个博客是怎样运作的', 'How this blog works');
    a.setAttribute('aria-label', t('文档', 'Docs'));
    a.append(svg, label);
    if (location.pathname.replace(/\/$/, '') === '/docs') a.setAttribute('aria-current', 'page');
    return a;
  }

  // Header buttons: Docs for everyone; a clear Sign in for readers; New post, Posts and Sign out for the author.
  function renderNav(me, { editId } = {}) {
    if (!me.signedIn) {
      nav.replaceChildren(docsButton(), el('a', { class: 'button primary sign-in', href: signInUrl(), text: t('登录', 'Sign in') }));
      return;
    }
    nav.replaceChildren(...[
      docsButton(true),
      editId ? el('a', { class: 'button', href: `/admin/posts/${editId}`, text: t('编辑', 'Edit') }) : null,
      el('a', { class: 'button', href: '/admin', text: t('文章', 'Posts') }),
      el('a', { class: 'button primary', href: '/admin/new', text: t('＋ 写文章', '＋ New post') }),
      el('a', { class: 'button', href: '/auth/logout?return=/', text: t('退出', 'Sign out') }),
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
    let heading = t('文章', 'Posts');
    if (month) {
      posts = posts.filter((post) => monthKey(post.publishedAt) === month);
      heading = monthLabel(month);
    } else if (search) {
      posts = posts.filter((post) => search.split(/\s+/).every((word) => `${post.title} ${post.excerpt}`.toLowerCase().includes(word)));
      heading = t(`包含“${params.get('s').trim()}”的文章`, `Posts matching “${params.get('s').trim()}”`);
    }
    setTitle(month || search ? heading : '');
    renderNav(me);
    redraw = () => homePage(me);
    page([
      el('div', { class: 'row spread head' }, [
        el('h1', { text: heading }),
        month || search ? el('a', { href: '/', text: t('所有文章', 'All posts') }) : el('span', { class: 'muted', text: posts.length ? postCount(posts.length) : '' }),
      ]),
      posts.length
        ? el('ul', { class: 'posts' }, posts.map((post) => el('li', {}, [
          el('a', { class: 'title', href: postPath(post.id), text: untitled(post.title) }),
          el('time', { datetime: post.publishedAt, text: fmtDate(post.publishedAt) }),
        ])))
        : el('p', { class: 'empty', text: t('还没有文章。', 'No posts yet.') }),
    ]);
  }

  function notFound(me) {
    setTitle(t('未找到', 'Not found'));
    renderNav(me);
    redraw = () => notFound(me);
    page(el('div', { class: 'empty' }, [el('h1', { text: t('页面不存在', 'Page not found') }), el('p', {}, el('a', { href: '/', text: t('查看所有文章', 'See all posts') }))]));
  }

  // Facebook-style reactions: one per visitor (the dl_vid cookie); clicking yours again removes it.
  const REACTIONS = [
    { id: 'like', emoji: '👍', label: ['赞', 'Like'], mine: ['你赞了这篇文章', 'You liked this post'] },
    { id: 'love', emoji: '❤️', label: ['爱心', 'Love'], mine: ['你给这篇文章送了爱心', 'You loved this post'] },
    { id: 'haha', emoji: '😂', label: ['哈哈', 'Haha'], mine: ['你觉得这篇文章很好笑', 'You found this post funny'] },
    { id: 'sad', emoji: '😢', label: ['难过', 'Sad'], mine: ['这篇文章让你难过', 'This post made you sad'] },
  ];

  // A visitor's page in the traffic monitor (private: Microsoft 365 sign-in).
  const visitorUrl = (id) => `https://traffic.dliu.com/visitor?visitor=${encodeURIComponent(id)}`;

  // Signed-in authors only: who reacted with what, each visitor ID linked to the traffic monitor.
  function whoReacted(postId) {
    const list = el('ul', { class: 'who-list' });
    const note = el('p', { class: 'who-note' });
    const section = el('div', { class: 'who-reacted', hidden: true }, [
      el('h2', { text: t('谁点了心情', 'Who reacted') }), note, list,
    ]);
    async function load() {
      try {
        const { reactions } = await api('GET', `/api/posts/${postId}/reactions`);
        note.textContent = reactions.length
          ? t(`${reactions.length} 位访客 · 只有已登录的作者能看到`, `${reactions.length} ${reactions.length === 1 ? 'visitor' : 'visitors'} · only signed-in authors see this`)
          : t('还没有人点心情 · 只有已登录的作者能看到', 'No reactions yet · only signed-in authors see this');
        list.replaceChildren(...reactions.map((item) => {
          const choice = REACTIONS.find((r) => r.id === item.reaction);
          return el('li', {}, [
            el('span', { class: 'who-reaction', title: choice ? tr(choice.label) : '' }, [
              el('span', { class: 'emoji', 'aria-hidden': 'true', text: choice ? choice.emoji : '' }), choice ? tr(choice.label) : item.reaction,
            ]),
            el('a', { class: 'who-visitor', href: visitorUrl(item.visitor), target: '_blank', rel: 'noopener noreferrer', title: t('在流量监控中查看这位访客', 'See this visitor in the traffic monitor'), text: item.visitor }),
            item.you ? el('span', { class: 'who-you', text: t('你', 'you') }) : null,
            el('time', { datetime: item.updatedAt || '', text: fmtDateTime(item.updatedAt) }),
          ]);
        }));
        section.hidden = false;
      } catch {
        section.hidden = true;
      }
    }
    load();
    return { section, load };
  }

  // Hidden until the counts arrive, so a failure leaves the post as it was.
  function reactionBar(postId, { signedIn = false } = {}) {
    const state = { counts: {}, mine: null };
    let busy = false;
    const status = el('p', { class: 'reaction-status', role: 'status' });
    const buttons = REACTIONS.map((choice) => {
      const count = el('span', { class: 'count' });
      const button = el('button', { type: 'button', class: 'reaction', onclick: () => choose(choice.id) }, [
        el('span', { class: 'emoji', 'aria-hidden': 'true', text: choice.emoji }), el('span', { class: 'label', text: tr(choice.label) }), count,
      ]);
      return { choice, button, count };
    });
    const who = signedIn ? whoReacted(postId) : null;
    const section = el('section', { class: 'reactions', 'aria-label': t('心情', 'Reactions'), hidden: true }, [
      el('div', { class: 'reaction-buttons' }, buttons.map((item) => item.button)), status, who && who.section,
    ]);

    function draw(error) {
      for (const { choice, button, count } of buttons) {
        const n = state.counts[choice.id] || 0;
        const pressed = state.mine === choice.id;
        count.textContent = n ? String(n) : '';
        button.setAttribute('aria-pressed', String(pressed));
        button.title = pressed ? t(`${tr(choice.label)}（再点一次取消）`, `${tr(choice.label)} (click again to remove)`) : tr(choice.label);
      }
      const mine = REACTIONS.find((choice) => choice.id === state.mine);
      status.textContent = error || (mine ? tr(mine.mine) : '');
      status.classList.toggle('error', Boolean(error));
    }

    async function choose(id) {
      if (busy) return;
      const before = { counts: { ...state.counts }, mine: state.mine };
      const next = state.mine === id ? null : id;
      if (state.mine) state.counts[state.mine] = Math.max(0, (state.counts[state.mine] || 0) - 1);
      if (next) state.counts[next] = (state.counts[next] || 0) + 1;
      state.mine = next;
      busy = true;
      draw();
      try {
        Object.assign(state, await api('POST', `/api/reactions/${postId}`, { reaction: next }));
        draw();
        if (who) who.load();
      } catch (error) {
        Object.assign(state, before);
        draw(error.status === 429 ? error.message : t('没能保存你的心情，请重试。', 'Your reaction could not be saved. Please try again.'));
      } finally {
        busy = false;
      }
    }

    api('GET', `/api/reactions/${postId}`).then((data) => {
      Object.assign(state, data);
      section.hidden = false;
      draw();
    }).catch(() => {});
    return section;
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
    redraw = () => postPage(me, id);
    page(el('article', { class: 'article' }, [
      el('a', { class: 'back', href: '/', text: t('← 所有文章', '← All posts') }),
      el('h1', { text: untitled(post.title) }),
      el('p', { class: 'meta' }, [el('time', { datetime: post.publishedAt, text: fmtDate(post.publishedAt) }), post.authorName ? ` · ${post.authorName}` : '']),
      el('div', { class: 'prose' }, md.render(post.body)),
      pictures.length ? el('div', { class: 'gallery' }, pictures.map((file) => el('a', { href: file.url }, el('img', { src: file.url, alt: file.name, loading: 'lazy' })))) : null,
      others.length ? el('section', { class: 'attachments' }, [
        el('h2', { text: t('附件', 'Attachments') }),
        el('ul', {}, others.map((file) => el('li', {}, el('a', { href: file.url }, [
          el('span', { class: 'ext', text: fileExt(file.name) }),
          el('span', { class: 'name', text: file.name }),
          el('span', { class: 'size', text: fmtSize(file.size) }),
        ])))),
      ]) : null,
      reactionBar(post.id, { signedIn: Boolean(me && me.signedIn) }),
    ]));
    return undefined;
  }

  // ---------- admin ----------
  function toLogin() {
    location.replace(signInUrl());
  }

  async function postsList(me, flash) {
    setTitle(t('文章', 'Posts'));
    const notices = el('div');
    const { posts } = await api('GET', '/api/posts');

    const rows = posts.map((post) => {
      const edit = `/admin/posts/${post.id}`;
      const published = post.status === 'published';
      const remove = async () => {
        if (!confirm(t(`删除“${untitled(post.title)}”？文章和它的文件将被永久删除。`, `Delete “${untitled(post.title)}”? This permanently deletes the post and its files.`))) return;
        try {
          await api('DELETE', `/api/posts/${post.id}`);
          await postsList(me, t('文章已删除。', 'Post deleted.'));
        } catch (error) {
          notice(notices, error.message, { error: true });
        }
      };
      return el('li', {}, [
        el('div', { class: 'info' }, [
          el('a', { class: 'title', href: edit, text: untitled(post.title) }),
          el('div', { class: 'meta' }, [
            el('span', { class: `pill ${post.status}`, text: published ? t('已发布', 'Published') : t('草稿', 'Draft') }),
            el('span', { text: published ? fmtDateTime(post.publishedAt) : t(`编辑于 ${fmtDateTime(post.updatedAt)}`, `Edited ${fmtDateTime(post.updatedAt)}`) }),
            el('span', { text: post.id }),
          ]),
        ]),
        el('div', { class: 'actions' }, [
          el('a', { class: 'button small', href: edit, text: t('编辑', 'Edit') }),
          published ? el('a', { class: 'button small', href: postPath(post.id), text: t('查看', 'View') }) : null,
          el('button', { type: 'button', class: 'small danger', text: t('删除', 'Delete'), onclick: remove }),
        ]),
      ]);
    });

    const publishedCount = posts.filter((p) => p.status === 'published').length;
    const draftCount = posts.length - publishedCount;
    renderNav(me);
    redraw = () => postsList(me);
    page([
      el('div', { class: 'row spread head' }, [
        el('h1', { text: t('所有文章', 'All posts') }),
        el('div', { class: 'row' }, [
          el('span', { class: 'muted', text: t(`${publishedCount} 篇已发布 · ${draftCount} 篇草稿`, `${publishedCount} published · ${plural(draftCount, 'draft')}`) }),
          el('a', { class: 'button small', href: '/docs/api', text: 'API', title: t('让 AI 代理或脚本用 Microsoft 访问令牌替你发文章', 'Let an AI agent or script post for you with a Microsoft access token') }),
        ]),
      ]),
      notices,
      rows.length ? el('ul', { class: 'posts admin' }, rows) : el('div', { class: 'empty' }, [
        el('p', { text: t('还没有文章。', 'No posts yet.') }),
        el('a', { class: 'button primary', href: '/admin/new', text: t('写第一篇文章', 'Write your first post') }),
      ]),
    ]);
    if (flash) notice(notices, flash);
  }

  async function newPost() {
    const post = await api('POST', '/api/posts', {});
    location.replace(`/admin/posts/${post.id}`);
  }

  // kept: unsaved title and text when the page is redrawn in another language.
  async function editor(me, id, kept) {
    let post = kept ? kept.post : await api('GET', `/api/posts/${id}`);
    let dirty = false;
    let uploading = 0;
    const signal = listeners.signal;

    const notices = el('div');
    const title = el('input', { type: 'text', class: 'title-input', id: 'title', value: kept ? kept.title : post.title, placeholder: t('标题', 'Title'), 'aria-label': t('标题', 'Title'), maxlength: '200' });
    const body = el('textarea', { id: 'body', 'aria-label': t('文章正文（Markdown）', 'Post text (Markdown)'), placeholder: t('用 Markdown 写文章…\n\n可以把图片拖到或粘贴到这里。把 video.dliu.com 的链接单独放一行即可显示视频。', 'Write your post in Markdown…\n\nDrop or paste pictures here. Put a video.dliu.com link on its own line to show the video.') });
    body.value = kept ? kept.body : post.body;
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
      // A Chinese character counts as one word; so does each run of other letters or digits.
      const words = (body.value.match(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu) || []).length;
      wordCount.textContent = t(`${words} 字`, `${words} words`);
    };
    setDirty();
    dirty = Boolean(kept && kept.dirty);

    function renderPermalink() {
      const url = `${location.origin}${postPath(post.id)}`;
      const published = post.status === 'published';
      permalink.replaceChildren(...[
        el('span', { text: t('链接：', 'Link: ') }),
        published ? el('a', { href: postPath(post.id), text: url }) : el('span', { text: url }),
        published ? null : el('em', { text: t('（发布后生效）', ' (works once published)') }),
      ].filter(Boolean));
    }

    function renderPublishBox() {
      const published = post.status === 'published';
      publishBox.replaceChildren(
        el('h2', { text: t('发布', 'Publish') }),
        el('dl', { class: 'facts' }, [
          el('dt', { text: t('状态', 'Status') }), el('dd', {}, el('span', { class: `pill ${post.status}`, text: published ? t('已发布', 'Published') : t('草稿', 'Draft') })),
          published ? [el('dt', { text: t('发布时间', 'Published') }), el('dd', { text: fmtDateTime(post.publishedAt) })] : null,
          el('dt', { text: t('上次保存', 'Last saved') }), el('dd', { text: fmtDateTime(post.updatedAt) }),
          el('dt', { text: t('文章 ID', 'Post ID') }), el('dd', { text: post.id }),
        ].flat()),
        el('div', { class: 'publish-actions' }, [
          el('button', { type: 'button', class: 'primary', text: published ? t('更新', 'Update') : t('发布', 'Publish'), onclick: () => save('published') }),
          published
            ? el('button', { type: 'button', text: t('取消发布（转回草稿）', 'Unpublish (back to draft)'), onclick: () => save('draft') })
            : el('button', { type: 'button', text: t('保存草稿', 'Save draft'), onclick: () => save('draft') }),
          published ? el('a', { class: 'button', href: postPath(post.id), text: t('查看文章', 'View post') }) : null,
          el('button', { type: 'button', class: 'link danger delete', text: t('删除文章', 'Delete post'), onclick: trash }),
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
            el('button', { type: 'button', class: 'link', text: t('插入', 'Insert'), onclick: () => insertAtCursor(snippet(file), { block: true }) }),
            el('button', { type: 'button', class: 'link danger', text: t('移除', 'Remove'), onclick: () => removeFile(file) }),
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
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(t(`上传失败（${xhr.status}）`, `Upload failed (${xhr.status})`))));
        xhr.onerror = () => reject(new Error(t('上传失败，请检查网络连接。', 'Upload failed. Check your connection.')));
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
          if (!file.size) throw new Error(t('文件是空的', 'File is empty'));
          if (file.size > MAX_FILE_BYTES) throw new Error(t(`文件最大 ${MAX_FILE_BYTES / 1048576} MB`, `Files can be at most ${MAX_FILE_BYTES / 1048576} MB`));
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
          if (!uploading && redrawWaiting) redrawPage();
        }
      }
    }

    async function removeFile(file) {
      const used = body.value.includes(file.url);
      if (!confirm(t(`移除 ${file.name}？${used ? '正文中还在使用它。' : ''}`, `Remove ${file.name}?${used ? ' It is still used in the post text.' : ''}`))) return;
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
        const view = { href: postPath(post.id), text: t('查看文章', 'View post') };
        if (status === 'published') notice(notices, wasPublished ? t('文章已更新。', 'Post updated.') : t('文章已发布。', 'Post published.'), { link: view });
        else notice(notices, wasPublished ? t('文章已转回草稿。', 'Post moved back to drafts.') : t('草稿已保存。', 'Draft saved.'));
        const time = new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
        savedAt.textContent = t(`已于 ${time} 保存`, `Saved at ${time}`);
        renderPublishBox();
        renderPermalink();
      } catch (error) {
        notice(notices, error.message, { error: true });
        if (error.status === 401) toLogin();
        buttons.forEach((b) => { b.disabled = false; });
      }
    }

    async function trash() {
      if (!confirm(t('删除这篇文章？文章和它的文件将被永久删除。', 'Delete this post? This permanently deletes the post and its files.'))) return;
      try {
        await api('DELETE', `/api/posts/${post.id}`);
        dirty = false;
        location.replace('/admin');
      } catch (error) {
        notice(notices, error.message, { error: true });
      }
    }

    // ---------- toolbar ----------
    function wrap(before, after = before, placeholder = t('文字', 'text')) {
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
      const url = prompt(t('链接地址', 'Link URL'), 'https://');
      if (url && url !== 'https://') wrap('[', `](${url})`, t('链接文字', 'link text'));
    }
    const tool = (label, name, action, cls) => el('button', { type: 'button', class: cls, title: name, 'aria-label': name, text: label, onclick: action });

    function renderPreview() {
      preview.replaceChildren(el('h1', { text: untitled(title.value) }), md.render(body.value));
    }
    const writeTab = el('button', { type: 'button', role: 'tab', text: t('撰写', 'Write'), onclick: () => showTab('write') });
    const previewTab = el('button', { type: 'button', role: 'tab', text: t('预览', 'Preview'), onclick: () => showTab('preview') });
    const toolbar = el('div', { class: 'toolbar' }, [
      tool('B', t('粗体', 'Bold'), () => wrap('**'), 'b'),
      tool('I', t('斜体', 'Italic'), () => wrap('*'), 'i'),
      tool('H2', t('标题', 'Heading'), () => prefixLines('## ')),
      tool('H3', t('小标题', 'Subheading'), () => prefixLines('### ')),
      tool('🔗', t('插入链接', 'Insert link'), addLink),
      tool('❝', t('引用', 'Quote'), () => prefixLines('> ')),
      tool('•', t('项目符号列表', 'Bulleted list'), () => prefixLines('- ')),
      tool('1.', t('编号列表', 'Numbered list'), () => prefixLines((i) => `${i + 1}. `)),
      tool('</>', t('代码', 'Code'), () => wrap('`')),
      tool('—', t('分隔线', 'Horizontal line'), () => insertAtCursor('---', { block: true })),
      tool(t('🖼 图片或文件', '🖼 Picture or file'), t('插入图片或文件', 'Insert a picture or file'), () => mediaInput.click()),
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
    const dropzone = el('label', { class: 'drop', for: 'attach-files' }, [t('把文件拖到这里，或', 'Drop files here or '), el('u', { text: t('选择文件', 'choose files') })]);
    dropTarget(dropzone, {});
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        save(post.status);
      }
    }, { signal });
    window.addEventListener('beforeunload', (event) => {
      if (dirty || uploading) {
        event.preventDefault();
        event.returnValue = '';
      }
    }, { signal });

    setTitle(post.title ? t(`编辑：${post.title}`, `Edit: ${post.title}`) : t('写文章', 'New post'));
    renderNav(me);
    // Uploads in progress would be lost, so a language switch waits for them.
    redraw = () => editor(me, id, { post, title: title.value, body: body.value, dirty });
    redrawBusy = () => uploading > 0;
    page([
      el('div', { class: 'row spread head' }, [el('h1', { text: post.createdAt === post.updatedAt && !post.title ? t('写文章', 'New post') : t('编辑文章', 'Edit post') }), el('a', { href: '/admin', text: t('← 所有文章', '← All posts') })]),
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
            el('h2', { text: t('文件', 'Files') }),
            el('p', { class: 'muted small', text: t('图片和文件会显示在文章末尾，除非已插入到正文中。', 'Pictures and files shown at the end of the post, unless inserted into the text.') }),
            attachInput, dropzone, fileList,
          ]),
        ]),
      ]),
    ], { wide: true });
    renderPermalink();
    renderPublishBox();
    renderFiles();
    showTab('write');
    if (!kept && !post.title) title.focus();
  }

  async function adminPage() {
    const me = await whoAmI({ force: true });
    if (me.configured === false) {
      renderNav(me);
      page([el('h1', { text: t('尚未配置登录', 'Sign-in is not configured') }), el('p', { text: t('运行 "make set-secrets" 保存 Microsoft Entra 应用设置。', 'Run "make set-secrets" to store the Microsoft Entra app settings.') })]);
      return;
    }
    if (!me.signedIn) return toLogin();
    const path = location.pathname.replace(/\/+$/, '');
    try {
      if (path === '/admin') return await postsList(me);
      if (path === '/admin/new') return await newPost();
      // The old API token page: blog tokens were replaced by Microsoft access tokens.
      if (path === '/admin/tokens') return location.replace('/docs/api');
      const match = /^\/admin\/posts\/(\d{10})$/.exec(path);
      if (match) return await editor(me, match[1]);
      renderNav(me);
      page([el('h1', { text: t('页面不存在', 'Page not found') }), el('p', {}, el('a', { href: '/admin', text: t('返回所有文章', 'Back to all posts') }))]);
    } catch (error) {
      if (error.status === 401) return toLogin();
      renderNav(me);
      page([el('h1', { text: error.status === 404 ? t('文章不存在', 'Post not found') : t('出错了', 'Something went wrong') }), el('p', { text: error.message }), el('p', {}, el('a', { href: '/admin', text: t('返回所有文章', 'Back to all posts') }))]);
    }
    return undefined;
  }

  // ---------- routing ----------
  // Each page sets redraw to draw itself again, with its state, when the language changes.
  let redraw = null;
  let redrawBusy = () => false;
  let redrawWaiting = false;
  let listeners = new AbortController();
  function redrawPage() {
    if (!redraw) return;
    if (redrawBusy()) { redrawWaiting = true; return; }
    redrawWaiting = false;
    listeners.abort();
    listeners = new AbortController();
    redrawBusy = () => false;
    Promise.resolve().then(redraw).catch(fail);
  }
  window.addEventListener('blog-language-change', redrawPage);

  function fail(error) {
    console.error(error);
    root.replaceChildren(el('p', { class: 'empty', text: t('出错了，请重新加载页面。', 'Something went wrong. Please reload the page.') }));
  }

  async function start() {
    redraw = start;
    const path = location.pathname;
    if (path === '/admin' || path.startsWith('/admin/')) return adminPage();
    const me = await whoAmI();
    if (path === '/' || path === '/index.html') return homePage(me);
    const match = /^\/(\d{10})\/?$/.exec(path);
    if (match) return postPage(me, match[1]);
    return notFound(me);
  }

  start().catch(fail);
})();
