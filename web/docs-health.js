import { renderNav } from './docs-nav.js';
import { icon } from './diagram.js';

// The page is static HTML (data-zh holds the Chinese); this adds the header, the title and the diagram icons.
const { t } = window.BlogI18n;
const setTitle = () => {
  document.title = `${t('健康检查', 'Health checks')} · ${t('文档', 'Docs')} · ${t('DL 博客', 'DL blog')}`;
};
renderNav();
setTitle();
window.addEventListener('blog-language-change', () => { renderNav(); setTitle(); });
for (const step of document.querySelectorAll('.dg-step[data-icon]')) step.prepend(icon(step.dataset.icon));
