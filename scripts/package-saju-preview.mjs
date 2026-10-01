// Regenerate only when intentionally importing a verified Gyeol release.
// Private app bytes live in private Storage, never in the public Git repository.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { Script } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Usage: node scripts/package-saju-preview.mjs /path/to/verified/saju-project');
const source = resolve(process.argv[2]);
const dist = await readFile(resolve(source, 'dist/index.html'), 'utf8');
if (!/<meta name="robots" content="noindex/.test(dist)) throw new Error('Import the noindex preview build only.');
const cssPath = dist.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/);
if (!cssPath || !/^\/assets\/[\w.-]+\.css$/.test(cssPath[1])) throw new Error('Expected one local CSS bundle.');
const css = await readFile(resolve(source, 'dist', cssPath[1].slice(1)), 'utf8');
const result = await build({ entryPoints: [resolve(source, 'src/main.tsx')], bundle: true, write: false,
  format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', minify: true, sourcemap: false,
  loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'inline' });
let script = result.outputFiles[0].text;
// srcdoc's relative links otherwise resolve against the administrator shell.
script += `\n;document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href^="#"]');if(!a)return;e.preventDefault();var id=a.getAttribute('href').slice(1);var target=id?document.getElementById(id):document.documentElement;if(target)target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},true);`;
new Script(script); // Parse the exact inline script before packaging it.
if (/<\/script/i.test(script) || /<\/style/i.test(css)) throw new Error('Unsafe inline closing tag in generated asset.');
const hash = createHash('sha256').update(script).digest('base64');
const scriptSource = `'sha256-${hash}'`;
const framePolicy = `default-src 'none'; script-src ${scriptSource}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
const body = dist.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1];
if (!body || /<script\b|<link\b|<iframe\b/i.test(body)) throw new Error('Unexpected resource element in preview body.');
const html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${framePolicy}"><title>결 — 관리자 전용 미리보기</title><style>${css}</style></head><body>${body}<script>${script}</script></body></html>`;
const packed = gzipSync(html, { level: 9 });
const sha256 = createHash('sha256').update(html).digest('hex');
const release = { bucket: 'saju-private-preview', objectPath: `${sha256}.html.gz`, sha256, scriptHash: hash, htmlBytes: Buffer.byteLength(html), gzipBytes: packed.length };
await mkdir(resolve(root, '.private-saju'), { recursive: true });
await writeFile(resolve(root, '.private-saju', release.objectPath), packed);
await writeFile(resolve(root, 'lib/saju-preview/release.js'), '// Public integrity metadata only. App bytes are in a private Storage bucket.\nexport const sajuRelease = ' + JSON.stringify(release, null, 2) + ';\n');
const configPath = resolve(root, 'vercel.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const shell = config.headers.find(item => item.source === '/admin-saju.html');
if (!shell) throw new Error('Missing admin shell header configuration.');
shell.headers.find(item => item.key === 'Content-Security-Policy').value = `default-src 'self'; script-src 'self' https://esm.sh ${scriptSource}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' about:; connect-src 'self' https://jhjxrkypnigcohgnzhvq.supabase.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`;
await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify({ source, ...release }));
