'use strict';

// App language, Chinese or English, as on weiqi.dliu.com. A choice saved in this browser wins;
// otherwise the browser's language decides (any zh-* is Chinese, everything else English).
// Posts are shown as written. Exposes window.BlogI18n for app.js and the docs pages.
(() => {
  const KEY = 'blog-language';
  const LANGUAGES = [['zh', '中文'], ['en', 'English']];

  function initialLanguage(saved, browserLanguage) {
    if (saved === 'zh' || saved === 'en') return saved;
    return /^zh(?:-|$)/i.test(browserLanguage || '') ? 'zh' : 'en';
  }

  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  let language = initialLanguage(saved, navigator.language);

  const t = (zh, en) => (language === 'zh' ? zh : en);
  const locale = () => (language === 'zh' ? 'zh-CN' : 'en-GB');

  // Messages the API sends, in Chinese. Anything unknown is shown as sent.
  const ERRORS = {
    'Sign in to do that': '请先登录',
    'Cross-site request refused': '已拒绝跨站请求',
    'Method not allowed': '不支持该请求方法',
    'Your reaction changed at the same time. Please try again.': '你的心情同时被修改了，请重试。',
    'Too many reactions from your network. Please try again later.': '你所在的网络点得太多了，请稍后再试。',
    'Request too large': '请求过大',
    'Expected application/json': '请求格式应为 JSON',
    'Expected a JSON object': '请求内容应为 JSON 对象',
    'Not found': '未找到',
    'Internal error': '服务器内部错误',
    'Sign-in not configured': '尚未配置登录',
    'File is empty': '文件是空的',
    'Upload failed. Check your connection.': '上传失败，请检查网络连接。',
  };
  const PATTERNS = [
    [/^At most (\d+) posts can be created in one day$/, (n) => `每天最多创建 ${n} 篇文章`],
    [/^Files can be at most (\d+) MB$/, (n) => `文件最大 ${n} MB`],
    [/^Upload failed \((\d+)\)$/, (n) => `上传失败（${n}）`],
    [/^Request failed \((\d+)\)$/, (n) => `请求失败（${n}）`],
  ];
  function translateError(message) {
    if (language !== 'zh' || !message) return message;
    if (ERRORS[message]) return ERRORS[message];
    for (const [pattern, zh] of PATTERNS) {
      const match = pattern.exec(message);
      if (match) return zh(...match.slice(1));
    }
    return message;
  }

  // Static HTML: data-zh holds the Chinese text, data-zh-label the Chinese aria-label.
  function translatePage() {
    for (const node of document.querySelectorAll('[data-zh]')) {
      if (node.dataset.en == null) node.dataset.en = node.textContent;
      node.textContent = t(node.dataset.zh, node.dataset.en);
    }
    for (const node of document.querySelectorAll('[data-zh-label]')) {
      if (node.dataset.enLabel == null) node.dataset.enLabel = node.getAttribute('aria-label') || '';
      node.setAttribute('aria-label', t(node.dataset.zhLabel, node.dataset.enLabel));
    }
  }

  let switcher = null;
  function setLanguage(value, { save = true } = {}) {
    language = value === 'zh' ? 'zh' : 'en';
    if (save) try { localStorage.setItem(KEY, language); } catch { /* storage blocked */ }
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    translatePage();
    if (switcher) switcher.update();
  }

  // Header switcher, the shared dl-language markup (dl.css): 中文 | English buttons; on narrow screens a 文/A
  // button opens them. It sits last in the header's dl-nav; the page scripts put it back after redrawing the nav.
  function mountSwitcher() {
    const nav = document.querySelector('.dl-header .dl-nav');
    if (!nav) return;
    const box = document.createElement('div');
    box.className = 'dl-language';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dl-button dl-language-toggle';
    toggle.textContent = '文/A';
    toggle.setAttribute('aria-controls', 'dl-languages');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Language / 语言');
    const group = document.createElement('div');
    group.id = 'dl-languages';
    group.className = 'dl-languages';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Language / 语言');
    const setOpen = (open) => {
      group.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };
    const buttons = LANGUAGES.map(([value, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.language = value;
      button.lang = value === 'zh' ? 'zh-CN' : 'en';
      button.textContent = label;
      button.addEventListener('click', () => {
        setOpen(false);
        if (value === language) return;
        setLanguage(value);
        window.dispatchEvent(new CustomEvent('blog-language-change', { detail: language }));
      });
      group.append(button);
      return button;
    });
    toggle.addEventListener('click', () => setOpen(!group.classList.contains('is-open')));
    document.addEventListener('click', (event) => { if (!box.contains(event.target)) setOpen(false); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && group.classList.contains('is-open')) { setOpen(false); toggle.focus(); }
    });
    box.append(toggle, group);
    nav.append(box);
    switcher = {
      element: box,
      update() {
        for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.language === language));
      },
    };
  }

  window.BlogI18n = {
    get language() { return language; }, t, locale, translateError, setLanguage, initialLanguage,
    // The switcher element, for the page scripts to keep last in the nav.
    get switcher() { return switcher ? switcher.element : null; },
  };

  const ready = () => { mountSwitcher(); setLanguage(language, { save: false }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
