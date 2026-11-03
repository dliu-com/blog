const fs = require('fs');
const path = require('path');

// The shared dliu.com look (https://files.dliu.com/dliu.com/README.md): every page loads dl.css first and uses
// the shared header (with the blog's own logo) and footer (with the DL logo); the blog's own stylesheet keeps only
// blog-specific rules.
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const exists = (file) => fs.existsSync(path.join(__dirname, '..', file));
const DL_CSS = '<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl.css">';
const DL_DOCS_CSS = '<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl-docs.css">';
const DL_ICON = 'https://files.dliu.com/dliu.com/favicon.png';
const PAGES = ['index', 'docs'];

test('every page loads the shared dliu.com stylesheet before any other', () => {
  for (const html of PAGES) {
    const page = read(`web/${html}.html`);
    const sheets = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
    expect(sheets[0]).toBe('https://files.dliu.com/dliu.com/ui/v1/dl.css');
    expect(sheets).toContain('/style.css');
    expect(page.indexOf(DL_CSS)).toBeLessThan(page.indexOf('<link rel="stylesheet" href="/style.css">'));
  }
});

test('every page has the shared header with the blog\'s own logo, and the shared footer with the DL logo', () => {
  for (const html of PAGES) {
    const page = read(`web/${html}.html`);
    expect(page).toContain('<link rel="icon" href="/logo.svg" type="image/svg+xml">');
    expect(page.match(/<link rel="icon"/g)).toHaveLength(1);
    expect(page).toContain('<body class="dl-page">');
    expect(page).toContain('<header class="dl-header">\n    <a class="dl-brand" href="/"><img class="dl-logo" src="/logo.svg" alt="" width="32" height="32"><span data-zh="DL 博客">DL blog</span></a>');
    expect(page).toContain('<nav class="dl-nav" id="nav" aria-label="Site"');
    expect(page).toMatch(/<main [^>]*class="dl-main[" ]/);
    expect(page).toContain(`<footer class="dl-footer">\n    <a class="dl-footer-logo" href="https://dliu.com" aria-label="dliu.com"><img src="${DL_ICON}" alt="" width="24" height="24"></a>\n    <a href="https://dliu.com">dliu.com</a> · `);
  }
  expect(exists('web/logo.svg')).toBe(true);
  expect(exists('web/favicon.ico')).toBe(true);
});

test('docs pages load the shared docs stylesheet and tabs, and the blog has no docs stylesheet of its own', () => {
  for (const html of ['docs']) {
    const page = read(`web/${html}.html`);
    expect(page.indexOf(DL_DOCS_CSS)).toBeGreaterThan(page.indexOf(DL_CSS));
    expect(page.indexOf(DL_DOCS_CSS)).toBeLessThan(page.indexOf('<link rel="stylesheet" href="/style.css">'));
    expect(page).toContain('<main class="dl-main dl-docs-main">');
    expect(page).toContain('<nav class="dl-tabs" aria-label="Docs sections"');
    expect(page).toMatch(/<article [^>]*class="dl-docs[" ]/);
    expect(page).not.toContain('/docs.css');
  }
  expect(exists('web/docs.css')).toBe(false);
});

test('the header scripts use the shared classes and keep the language switcher last in the nav', () => {
  for (const file of ['web/app.js', 'web/docs-nav.js']) {
    const js = read(file);
    expect(js).toContain("'dl-button dl-signin'");
    expect(js).toContain("'dl-button dl-button-primary'");
    expect(js).toMatch(/nav\.replaceChildren\(\.\.\.items(?:\.filter\(Boolean\))?, \.\.\.\[window\.BlogI18n\.switcher\]\.filter\(Boolean\)\)/);
    expect(js).not.toMatch(/(?:class:|className =|link\() ?['`](?:[^'`]* )?(?:button|primary|sign-in|muted|panel|notice|error)\b/);
  }
  const i18n = read('web/i18n.js');
  expect(i18n).toContain("box.className = 'dl-language'");
  expect(i18n).toContain("toggle.className = 'dl-button dl-language-toggle'");
  expect(i18n).toContain("group.className = 'dl-languages'");
  expect(i18n).toContain("document.querySelector('.dl-header .dl-nav')");
});

test('the blog stylesheet leaves the header, buttons, switcher and palette to the shared stylesheet', () => {
  const css = read('web/style.css');
  expect(css).not.toMatch(/header\.top|\.brand|^\s*button|\.button\b|\.languages?\b|--accent:|^\s*:root/m);
  expect(css).not.toMatch(/var\(--(bg|panel|panel-2|line|text|muted|accent|accent-2|danger|ok|radius)\)/);
});

test('the editor uses the kit\'s quiet small buttons and small segmented tabs instead of local copies', () => {
  const app = read('web/app.js');
  const css = read('web/style.css');
  expect(app).toContain("class: `dl-button dl-button-quiet dl-button-small${cls ? ` ${cls}` : ''}`");
  expect(app).toContain("class: 'dl-segmented dl-segmented-small', role: 'tablist'");
  expect(css).not.toMatch(/\.toolbar > button|\.dl-segmented[^{]*>\s*button|dl-button-link\.dl-button-danger/);
  expect(read('web/diagram.js')).not.toContain('#2563eb');
});
