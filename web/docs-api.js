import { renderNav } from './docs-nav.js';

// The guide is written once, in Markdown, at /docs/api.md (which agents read as is); this page renders it.
renderNav();
const root = document.getElementById('api-doc');
try {
  const response = await fetch('/docs/api.md', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const source = (await response.text()).replace(/^# .*\n+/, '');
  root.replaceChildren(window.BlogMarkdown.render(source));
} catch {
  root.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Could not load the guide. Open /docs/api.md instead.' }));
}
