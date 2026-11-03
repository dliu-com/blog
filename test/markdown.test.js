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

test('XSS payloads: no script URL, event handler, raw tag or foreign frame ever reaches the DOM', () => {
  // Checks every element the renderer creates (not the serialised string), so escaping in the test serialiser hides nothing.
  const elements = [];
  let inspected = 0;
  const tracked = { ...doc, createElement: (tag) => { const n = node(tag); elements.push(n); return n; } };
  const payloads = [
    '[x](javascript:alert(1))', '[x](JAVASCRIPT:alert(1))', '[x]( javascript:alert(1))', '[x](<javascript:alert(1)>)',
    '[x](java&#115;cript:alert(1))', '[x](&#106;avascript:alert(1))', '[x](%6Aavascript:alert(1))', '[x](java\tscript:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)', '[x](vbscript:msgbox(1))', '[x](file:///etc/passwd)',
    '[x](//evil.example)', '[x](/\\evil.example)', '[x](\\\\evil.example)',
    '![x](javascript:alert(1))', '![x](data:image/svg+xml,<svg onload=alert(1)>)', '![x](https://a.example/x.png" onerror="alert(1))',
    '[x](https://a.example "t\\" onmouseover=\\"alert(1)")', '[[x](javascript:alert(1))](https://a.example)', '[x](https://a.example)(javascript:alert(1))',
    '<script>alert(1)</script>', '<svg onload=alert(1)>', '<a href="javascript:alert(1)">x</a>', '<iframe src="https://evil.example"></iframe>',
    '<iframe src="https://video.dliu.com/embed/2025010100" onload="alert(1)" srcdoc="<script>alert(1)</script>"></iframe>',
    '<iframe src="https://video.dliu.com/embed/2025010100?x=1&quot; onload=&quot;alert(1)" style="aspect-ratio: 16/9; background:url(javascript:alert(1))"></iframe>',
    'https://video.dliu.com/embed/2025010100?t=1"onload="alert(1)', 'https://video.dliu.com.evil.example/embed/2025010100',
    'https://video.dliu.com/embed/2025010100/../../evil', '[v](https://video.dliu.com/watch?v=2025010100&autoplay=1&t=javascript:1)',
    '```\n<script>alert(1)</script>\n```', '`<img src=x onerror=alert(1)>`', '# <img src=x onerror=alert(1)>', '> <script>alert(1)</script>',
  ];
  for (const source of payloads) {
    elements.length = 0;
    md.render(source, tracked);
    inspected += elements.length;
    for (const el of elements) {
      expect(['script', 'style', 'object', 'embed', 'svg', 'form', 'base', 'meta', 'link']).not.toContain(el.tag);
      for (const [name, value] of Object.entries(el.attrs)) {
        expect(name).not.toMatch(/^on|^srcdoc$|^style$|^formaction$/i);
        if (name === 'href' || name === 'src') expect(value).toMatch(/^(https?:\/\/|mailto:|\/(?![\/\\])|#)/i);
      }
      if (el.tag === 'iframe') expect(el.attrs.src).toMatch(/^https:\/\/video\.dliu\.com\/embed\/\d{10}(\?(t=[\d.]+|autoplay=1|muted=1|loop=1)(&(t=[\d.]+|autoplay=1|muted=1|loop=1))*)?$/);
    }
  }
  expect(inspected).toBeGreaterThan(payloads.length);
});

test('pictures and links', () => {
  expect(render('![Cliffs](/media/a/b/c.jpg)')).toContain('<img src="/media/a/b/c.jpg" alt="Cliffs" loading="lazy">');
  expect(render('[site](https://dliu.com)')).toContain('<a href="https://dliu.com" target="_blank" rel="noopener noreferrer nofollow">site</a>');
  expect(render('[post](/2026102801)')).toContain('<a href="/2026102801">post</a>');
  expect(render('[mail](mailto:user@example.com)')).toContain('<a href="mailto:user@example.com">mail</a>');
  const here = { ...doc, location: { host: 'blog.dliu.com' } };
  const html = (source) => md.render(source, here).html();
  expect(html('[same](https://blog.dliu.com/2026102801)')).toContain('<a href="https://blog.dliu.com/2026102801">same</a>');
  expect(html('[other](https://dliu.com)')).toContain('target="_blank"');
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

describe('videos from video.dliu.com', () => {
  const frame = (src, title = 'Video') => `<div class="video"><iframe src="${src}" title="${title}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  const embed = 'https://video.dliu.com/embed/2025010100';

  test('a video link on its own line becomes the player', () => {
    for (const link of ['https://video.dliu.com/2025010100', 'https://video.dliu.com/watch?v=2025010100', embed, '<https://video.dliu.com/2025010100>']) {
      expect(render(link)).toBe(frame(embed));
    }
    expect(render('Intro\n\n[Our trip](https://video.dliu.com/2025010100)\n\nAfter')).toBe(
      `<p>Intro</p>${frame(embed, 'Our trip')}<p>After</p>`,
    );
  });

  test('the embed code copied from a video page becomes the player', () => {
    const code = '<iframe src="https://video.dliu.com/embed/2025010100?t=42&amp;muted=1" title="A &quot;day&quot; out" style="width:100%;aspect-ratio:9/16;border:0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>';
    const el = md.render(code, doc);
    expect(el.html()).toBe(frame(`${embed}?t=42&amp;muted=1`, 'A &quot;day&quot; out'));
  });

  test('only known player options with safe values are kept', () => {
    expect(render('https://video.dliu.com/2025010100?t=90&autoplay=1&loop=1&evil=x')).toBe(frame(`${embed}?t=90&amp;autoplay=1&amp;loop=1`));
    expect(render('https://video.dliu.com/watch?v=2025010100&t=1e9')).toBe(frame(embed));
    expect(render('https://video.dliu.com/2025010100?autoplay=true')).toBe(frame(embed));
  });

  test('other sites, bad ids and links inside text are not embedded', () => {
    for (const text of [
      'https://video.dliu.com.evil.example/2025010100',
      'https://evil.example/embed/2025010100',
      'http://video.dliu.com/2025010100',
      'https://video.dliu.com/123',
      'https://video.dliu.com/2025010100/../../x',
      'See https://video.dliu.com/2025010100 here',
      '<iframe src="https://evil.example/embed/2025010100"></iframe>',
      '<iframe src="https://video.dliu.com/embed/2025010100" onload="alert(1)"></iframe><script>x</script>',
    ]) {
      expect(render(text)).not.toContain('<iframe');
    }
    expect(render('https://video.dliu.com/2025010100\nmore text')).not.toContain('<iframe');
  });
});
