import { renderNav } from './docs-nav.js';

// The guide is written once, in Markdown, at /docs/api.md (which agents read as is); this page renders it.
const { t } = window.BlogI18n;
const setTitle = () => {
  document.title = `API · ${t('文档', 'Docs')} · ${t('DL 博客', 'DL blog')}`;
  document.querySelector('.api-language-note').hidden = window.BlogI18n.language !== 'zh';
};
renderNav();
setTitle();
window.addEventListener('blog-language-change', () => { renderNav(); setTitle(); });
const root = document.getElementById('api-doc');
try {
  const response = await fetch('/docs/api.md', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const source = (await response.text()).replace(/^# .*\n+/, '');
  root.replaceChildren(window.BlogMarkdown.render(source));
} catch {
  root.replaceChildren(Object.assign(document.createElement('p'), { textContent: t('无法加载指南，请直接打开 /docs/api.md。', 'Could not load the guide. Open /docs/api.md instead.') }));
}
