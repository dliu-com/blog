import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stageVersionedWeb, versionWeb } from '../lib/versioned-web';

const WEB = path.join(__dirname, '..', 'web');
const sha = (body: Buffer) => crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);

describe('deployed pages load scripts and styles by content hash', () => {
  const out = versionWeb(WEB);
  const text = (name: string) => out.get(name)!.toString('utf8');

  test('every local script and stylesheet in every page carries ?v=<hash of the deployed file>', () => {
    const pages = [...out.keys()].filter((name) => name.endsWith('.html'));
    expect(pages.sort()).toEqual(['docs.html', 'index.html']);
    for (const page of pages) {
      const source = fs.readFileSync(path.join(WEB, page), 'utf8');
      const local = [...source.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="\/([\w.-]+\.(?:js|css))"/g)].map(([, file]) => file);
      expect(local.length).toBeGreaterThanOrEqual(3);
      const versioned = [...text(page).matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="\/([\w.-]+\.(?:js|css))(\?v=[0-9a-f]{12})?"/g)];
      expect(versioned.map(([, file]) => file)).toEqual(local);
      for (const [, file, query] of versioned) expect([page, file, query]).toEqual([page, file, `?v=${sha(out.get(file)!)}`]);
    }
    expect(text('docs.html')).toMatch(/<script type="module" src="\/docs\.js\?v=[0-9a-f]{12}"><\/script>/);
    expect(text('docs.html')).toMatch(/<link rel="stylesheet" href="\/style\.css\?v=[0-9a-f]{12}">/);
  });

  test('modules import their siblings by content hash too', () => {
    const imports = [...text('docs.js').matchAll(/from '\.\/([\w.-]+\.js)(\?v=[0-9a-f]{12})?'/g)];
    expect(imports.map(([, file]) => file).sort()).toEqual(['diagram.js', 'docs-nav.js']);
    for (const [, file, query] of imports) expect(query).toBe(`?v=${sha(out.get(file)!)}`);
    for (const [name, body] of out) {
      if (name.endsWith('.js')) expect(body.toString('utf8')).not.toMatch(/(from\s*|import\s*\(?\s*)['"]\.\/[\w.-]+\.js['"]/);
    }
  });

  test('changing a module changes the URL of every page and module that loads it, directly or not', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-web-test-'));
    try {
      fs.cpSync(WEB, dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'diagram.js'), '\n// changed\n');
      const changed = versionWeb(dir);
      const url = (map: Map<string, Buffer>, file: string) => map.get('docs.html')!.toString('utf8').match(new RegExp(`/${file.replace('.', '\\.')}\\?v=\\w+`))![0];
      expect(url(changed, 'docs.js')).not.toBe(url(out, 'docs.js'));
      expect(url(changed, 'style.css')).toBe(url(out, 'style.css'));
      expect(changed.get('index.html')).toEqual(out.get('index.html'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the source files keep plain URLs, the deployed copy has the same files, and other files are unchanged', () => {
    expect(fs.readFileSync(path.join(WEB, 'docs.html'), 'utf8')).toContain('<script type="module" src="/docs.js"></script>');
    const staged = stageVersionedWeb(WEB);
    const list = (dir: string, prefix = ''): string[] => fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? list(dir, path.posix.join(prefix, e.name)) : [path.posix.join(prefix, e.name)]));
    expect(list(staged).sort()).toEqual(list(WEB).sort());
    for (const name of list(WEB)) {
      expect(fs.readFileSync(path.join(staged, name))).toEqual(out.get(name));
      if (!/\.(html|js)$/.test(name)) expect(out.get(name)).toEqual(fs.readFileSync(path.join(WEB, name)));
    }
  });

  test('the stack deploys the versioned copy, not web/ itself', () => {
    const stack = fs.readFileSync(path.join(__dirname, '..', 'lib', 'blog-stack.ts'), 'utf8');
    expect(stack).toContain("const webAsset = s3deploy.Source.asset(stageVersionedWeb(path.join(ROOT, 'web')), { exclude: [API_DOC] });");
    expect(stack.match(/s3deploy\.Source\.asset\(/g)).toHaveLength(1);
  });
});
