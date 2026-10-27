'use strict';

// A small, safe Markdown renderer. It builds DOM nodes (never HTML strings), so nothing in a post can run script.
// Supported: headings, paragraphs, line breaks, **bold**, *italic*, ~~strike~~, `code`, fenced code blocks,
// > quotes, - and 1. lists (nested by indenting), --- rules, [links](url), ![images](url) and bare https:// links.
(function (root) {
  const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
  const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
  const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^\s{0,3}>\s?/;
  const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+/;
  const blank = (line) => /^\s*$/.test(line);
  const startsBlock = (line) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST.test(line);

  function parseList(lines, start) {
    const first = LIST.exec(lines[start]);
    const indent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const items = [];
    let current = null;
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      const match = LIST.exec(line);
      if (match && match[1].length <= indent + 1 && /\d/.test(match[2]) === ordered) {
        current = [line.slice(match[0].length)];
        items.push(current);
        i += 1;
        continue;
      }
      if (match && match[1].length <= indent + 1) break;
      if (blank(line)) {
        const next = lines[i + 1];
        const nextItem = next !== undefined && LIST.exec(next);
        if (next !== undefined && ((nextItem && nextItem[1].length <= indent + 1 && /\d/.test(nextItem[2]) === ordered)
          || /^\s{2,}\S/.test(next))) {
          current.push('');
          i += 1;
          continue;
        }
        break;
      }
      if (/^\s/.test(line) || !startsBlock(line)) {
        current.push(line.replace(new RegExp(`^\\s{0,${indent + 4}}`), ''));
        i += 1;
        continue;
      }
      break;
    }
    return {
      block: { type: 'list', ordered, start: ordered ? parseInt(first[2], 10) : null, items: items.map((item) => parseBlocks(item.join('\n'))) },
      next: i,
    };
  }

  function parseBlocks(source) {
    const lines = String(source || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let match;
      if (blank(line)) {
        i += 1;
      } else if ((match = FENCE.exec(line))) {
        const fence = match[1];
        const body = [];
        i += 1;
        while (i < lines.length && !(lines[i].trim().startsWith(fence[0].repeat(fence.length)) && /^\s*[`~]+\s*$/.test(lines[i]))) {
          body.push(lines[i]);
          i += 1;
        }
        i += 1;
        blocks.push({ type: 'code', lang: match[2], text: body.join('\n') });
      } else if ((match = HEADING.exec(line))) {
        blocks.push({ type: 'heading', level: match[1].length, children: parseInline(match[2]) });
        i += 1;
      } else if (RULE.test(line)) {
        blocks.push({ type: 'rule' });
        i += 1;
      } else if (QUOTE.test(line)) {
        const body = [];
        while (i < lines.length && (QUOTE.test(lines[i]) || (!blank(lines[i]) && !startsBlock(lines[i]) && body.length && !blank(body[body.length - 1])))) {
          body.push(lines[i].replace(QUOTE, ''));
          i += 1;
        }
        blocks.push({ type: 'quote', children: parseBlocks(body.join('\n')) });
      } else if (LIST.test(line)) {
        const { block, next } = parseList(lines, i);
        blocks.push(block);
        i = next;
      } else {
        const body = [];
        while (i < lines.length && !blank(lines[i]) && (!body.length || !startsBlock(lines[i]))) {
          body.push(lines[i]);
          i += 1;
        }
        blocks.push({ type: 'paragraph', children: parseInline(body.map((l) => l.trim()).join('\n')) });
      }
    }
    return blocks;
  }

  // Only web links, mail links and same-site paths; anything else (javascript:, data:, …) is dropped.
  function safeUrl(url, { image = false } = {}) {
    const value = String(url || '').trim();
    if (/^https?:\/\//i.test(value)) return value;
    if (!image && /^mailto:/i.test(value)) return value;
    if (/^\/(?![\/\\])/.test(value) || (!image && /^#/.test(value))) return value;
    return null;
  }

  // [label](url "title") starting at text[start] === '['. Returns null if it isn't one.
  function matchLink(text, start) {
    let depth = 0;
    let i = start;
    for (; i < text.length; i += 1) {
      const c = text[i];
      if (c === '\\') { i += 1; continue; }
      if (c === '[') depth += 1;
      if (c === ']') { depth -= 1; if (depth === 0) break; }
    }
    if (depth !== 0 || text[i + 1] !== '(') return null;
    const close = i;
    let parens = 0;
    let j = close + 1;
    for (; j < text.length; j += 1) {
      if (text[j] === '(') parens += 1;
      if (text[j] === ')') { parens -= 1; if (parens === 0) break; }
      if (text[j] === '\n') return null;
    }
    if (parens !== 0) return null;
    const inner = text.slice(close + 2, j).trim();
    const parts = /^<?([^\s>]*)>?(?:\s+["'](.*)["'])?$/.exec(inner);
    if (!parts) return null;
    return { label: text.slice(start + 1, close), url: parts[1], title: parts[2] || '', end: j + 1 };
  }

  function parseInline(text) {
    const out = [];
    let buffer = '';
    let i = 0;
    const flush = () => {
      if (buffer) out.push({ type: 'text', text: buffer });
      buffer = '';
    };
    while (i < text.length) {
      const c = text[i];
      if (c === '\\' && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!>~|]/.test(text[i + 1])) {
        buffer += text[i + 1];
        i += 2;
        continue;
      }
      if (c === '\\' && text[i + 1] === '\n') {
        flush();
        out.push({ type: 'break' });
        i += 2;
        continue;
      }
      if (c === '\n') {
        flush();
        out.push({ type: 'break' });
        i += 1;
        continue;
      }
      if (c === '`') {
        const end = text.indexOf('`', i + 1);
        if (end > i + 1) {
          flush();
          out.push({ type: 'code', text: text.slice(i + 1, end) });
          i = end + 1;
          continue;
        }
      }
      if (c === '!' && text[i + 1] === '[') {
        const link = matchLink(text, i + 1);
        const src = link && safeUrl(link.url, { image: true });
        if (src) {
          flush();
          out.push({ type: 'image', src, alt: link.label.replace(/\\(.)/g, '$1'), title: link.title });
          i = link.end;
          continue;
        }
      }
      if (c === '[') {
        const link = matchLink(text, i);
        if (link) {
          const href = safeUrl(link.url);
          flush();
          if (href) out.push({ type: 'link', href, title: link.title, children: parseInline(link.label) });
          else out.push(...parseInline(link.label));
          i = link.end;
          continue;
        }
      }
      if (c === '*' || c === '_' || c === '~') {
        const double = text[i + 1] === c;
        if (c !== '~' || double) {
          const marker = double ? c + c : c;
          const from = i + marker.length;
          const end = text.indexOf(marker, from);
          const wordInside = c === '_' && (/\w/.test(text[i - 1] || '') || /\w/.test(text[end + marker.length] || ''));
          if (end > from && !/\s/.test(text[from]) && !/\s/.test(text[end - 1]) && !wordInside) {
            flush();
            const type = c === '~' ? 'strike' : double ? 'strong' : 'em';
            out.push({ type, children: parseInline(text.slice(from, end)) });
            i = end + marker.length;
            continue;
          }
        }
      }
      if ((c === 'h' || c === 'H') && /[\s(]/.test(text[i - 1] || ' ')) {
        const match = /^https?:\/\/[^\s<]*[^\s<.,:;"')\]!?*_~]/i.exec(text.slice(i));
        if (match) {
          flush();
          out.push({ type: 'link', href: match[0], title: '', children: [{ type: 'text', text: match[0] }] });
          i += match[0].length;
          continue;
        }
      }
      buffer += c;
      i += 1;
    }
    flush();
    return out;
  }

  const parse = (source) => parseBlocks(source);

  function renderInline(nodes, doc) {
    const fragment = doc.createDocumentFragment();
    for (const node of nodes) {
      let el;
      switch (node.type) {
        case 'text': fragment.append(doc.createTextNode(node.text)); continue;
        case 'break': el = doc.createElement('br'); break;
        case 'code': el = doc.createElement('code'); el.textContent = node.text; break;
        case 'strong': el = doc.createElement('strong'); el.append(renderInline(node.children, doc)); break;
        case 'em': el = doc.createElement('em'); el.append(renderInline(node.children, doc)); break;
        case 'strike': el = doc.createElement('del'); el.append(renderInline(node.children, doc)); break;
        case 'link':
          el = doc.createElement('a');
          el.setAttribute('href', node.href);
          if (node.title) el.setAttribute('title', node.title);
          if (/^https?:/i.test(node.href)) el.setAttribute('rel', 'noopener noreferrer nofollow');
          el.append(renderInline(node.children, doc));
          break;
        case 'image':
          el = doc.createElement('img');
          el.setAttribute('src', node.src);
          el.setAttribute('alt', node.alt);
          if (node.title) el.setAttribute('title', node.title);
          el.setAttribute('loading', 'lazy');
          break;
        default: continue;
      }
      fragment.append(el);
    }
    return fragment;
  }

  function renderBlocks(blocks, doc) {
    const fragment = doc.createDocumentFragment();
    for (const block of blocks) {
      let el;
      switch (block.type) {
        case 'heading': el = doc.createElement(`h${block.level}`); el.append(renderInline(block.children, doc)); break;
        case 'paragraph': el = doc.createElement('p'); el.append(renderInline(block.children, doc)); break;
        case 'rule': el = doc.createElement('hr'); break;
        case 'quote': el = doc.createElement('blockquote'); el.append(renderBlocks(block.children, doc)); break;
        case 'code': {
          el = doc.createElement('pre');
          const code = doc.createElement('code');
          code.textContent = block.text;
          el.append(code);
          break;
        }
        case 'list':
          el = doc.createElement(block.ordered ? 'ol' : 'ul');
          if (block.ordered && block.start !== 1) el.setAttribute('start', String(block.start));
          for (const item of block.items) {
            const li = doc.createElement('li');
            // Tight items: a single paragraph renders without the <p>.
            if (item.length === 1 && item[0].type === 'paragraph') li.append(renderInline(item[0].children, doc));
            else li.append(renderBlocks(item, doc));
            el.append(li);
          }
          break;
        default: continue;
      }
      fragment.append(el);
    }
    return fragment;
  }

  function render(source, doc = root.document) {
    return renderBlocks(parse(source), doc);
  }

  const api = { parse, parseInline, render, safeUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlogMarkdown = api;
}(typeof window !== 'undefined' ? window : globalThis));
