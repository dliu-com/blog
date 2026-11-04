import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The HTML shells are no-cache, but scripts and styles are kept by browsers for five minutes, so after a deploy
// a new page could run an old script. The deployed copy of web/ therefore loads each local script and stylesheet
// as /<file>?v=<hash of its content>, and each module imports its siblings the same way. A module's hash covers
// its rewritten imports, so a change to diagram.js also changes the URL of docs.js, which imports it.
// CloudFront ignores the query string (CACHING_OPTIMIZED), and the files in S3 keep their plain names.

const IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])\.\/([\w.-]+\.js)\2/g;
const PAGE_ASSET = /(<(?:script|link)\b[^>]*?\s(?:src|href)=")\/([\w.-]+\.(?:js|css))(")/g;

const hash = (text: string) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);

function files(dir: string, prefix = ''): string[] {
  return fs.readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const name = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? files(dir, name) : [name];
  });
}

/** Rewrites web/ in memory: file name -> contents, with versioned script and stylesheet URLs. */
export function versionWeb(dir: string): Map<string, Buffer> {
  const out = new Map(files(dir).map((name) => [name, fs.readFileSync(path.join(dir, name))]));
  const versions = new Map<string, string>();
  const visiting = new Set<string>();
  const version = (name: string): string => {
    const known = versions.get(name);
    if (known) return known;
    const source = out.get(name);
    if (!source) throw new Error(`web/${name} is referenced but does not exist`);
    if (!name.endsWith('.js')) {
      versions.set(name, hash(source.toString('latin1')));
      return versions.get(name)!;
    }
    if (visiting.has(name)) throw new Error(`web/${name} is part of an import cycle`);
    visiting.add(name);
    const text = source.toString('utf8').replace(IMPORT, (_, lead, quote, dep) => `${lead}${quote}./${dep}?v=${version(dep)}${quote}`);
    visiting.delete(name);
    out.set(name, Buffer.from(text));
    versions.set(name, hash(text));
    return versions.get(name)!;
  };
  for (const name of out.keys()) if (/\.(js|css)$/.test(name) && !name.includes('/')) version(name);
  for (const name of [...out.keys()].filter((n) => n.endsWith('.html'))) {
    const text = out.get(name)!.toString('utf8').replace(PAGE_ASSET, (_, lead, file, end) => `${lead}/${file}?v=${version(file)}${end}`);
    out.set(name, Buffer.from(text));
  }
  return out;
}

/** Writes the versioned copy of web/ to a directory named after its contents, and returns that directory. */
export function stageVersionedWeb(dir: string): string {
  const out = versionWeb(dir);
  const all = crypto.createHash('sha256');
  for (const [name, body] of [...out].sort(([a], [b]) => a.localeCompare(b))) all.update(name).update('\0').update(body);
  const target = path.join(os.tmpdir(), `blog-web-${all.digest('hex').slice(0, 16)}`);
  // Written to a temporary directory and renamed, so the target exists only when complete.
  if (!fs.existsSync(target)) {
    const temp = fs.mkdtempSync(`${target}.tmp-`);
    for (const [name, body] of out) {
      fs.mkdirSync(path.dirname(path.join(temp, name)), { recursive: true });
      fs.writeFileSync(path.join(temp, name), body);
    }
    try {
      fs.renameSync(temp, target);
    } catch {
      fs.rmSync(temp, { recursive: true, force: true }); // another synth staged the same contents first
    }
  }
  return target;
}
