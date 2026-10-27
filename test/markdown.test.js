'use strict';

const md = require('../web/markdown');

// Just enough DOM for render(); serialises like innerHTML would, escaping text and attributes.
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function node(tag) {
  const children = [];
  const attrs = {};
  return {
    tag,
    attrs,
    append(...items) { children.push(...items); },
    setAttribute(name, value) { attrs[name] = String(value); },
    set textContent(value) { children.length = 0; children.push({ html: () => escape(value) }); },
    html() {
      const inner = children.map((child) => child.html()).join('');
      if (!tag) return inner;
      const attributes = Object.entries(attrs).map(([k, v]) => ` ${k}="${escape(v)}"`).join('');
      return `<${tag}${attributes}>${inner}</${tag}>`;
    },
  };
}
const doc = {
  createElement: node,
  createDocumentFragment: () => node(''),
  createTextNode: (text) => ({ html: () => escape(text) }),
};
const render = (source) => md.render(source, doc).html();

test('renders the common Markdown blocks', () => {
  expect(render('# Title\n\nSome **bold**, *em* and `code`.\n\n- one\n- two\n\n> quoted\n\n```\ncode <b>\n```\n\n---')).toBe(
    '<h1>Title</h1><p>Some <strong>bold</strong>, <em>em</em> and <code>code</code>.</p>'
    + '<ul><li>one</li><li>two</li></ul><blockquote><p>quoted</p></blockquote>'
    + '<pre><code>code &lt;b&gt;</code></pre><hr></hr>',
  );
});

test('HTML in posts is shown as text, never interpreted', () => {
  expect(render('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
});

test('pictures and links', () => {
  expect(render('![Cliffs](/media/a/b/c.jpg)')).toContain('<img src="/media/a/b/c.jpg" alt="Cliffs" loading="lazy">');
  expect(render('[site](https://dliu.com)')).toContain('<a href="https://dliu.com" rel="noopener noreferrer nofollow">site</a>');
  expect(render('[x](javascript:alert(1))')).not.toContain('href');
  expect(render('![x](javascript:alert(1))')).not.toContain('<img');
});

test('only safe URLs become links and images', () => {
  expect(md.safeUrl('https://dliu.com/x')).toBe('https://dliu.com/x');
  expect(md.safeUrl('/media/a/b/c.jpg', { image: true })).toBe('/media/a/b/c.jpg');
  expect(md.safeUrl('mailto:user@example.com')).toBe('mailto:user@example.com');
  for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.example/x', '/\\evil.example']) {
    expect(md.safeUrl(bad)).toBeNull();
  }
  expect(md.safeUrl('mailto:user@example.com', { image: true })).toBeNull();
});
