// Packaging: bundle TS -> IIFE, inline pdf.js worker as Base64 in a non-executable tag (Option A, speed).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { ANALYZER_VERSION } from '../src/version';

const root = process.cwd();
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
const res = await build({
  entryPoints: [path.join(root, 'src/index.ts')], bundle: true, format: 'iife', minify: true, write: false,
  target: ['es2020'], define: { 'import.meta.url': '"about:blank"', __APP_VERSION__: JSON.stringify(pkg.version) }, logLevel: 'warning', legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const worker = fs.readFileSync(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'));
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const payload = `<script id="pdfjs-worker" type="application/octet-stream">${worker.toString('base64')}</script>\n<script>${js}</script>`;
const final = html.replace('<!--PAYLOAD-->', () => payload).replaceAll('__APP_VERSION__', pkg.version).replaceAll('__ANALYZER_VERSION__', String(ANALYZER_VERSION));
fs.writeFileSync(path.join(out, 'clause-lab.html'), final);
fs.mkdirSync(path.join(out, 'examples'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'examples'))) fs.copyFileSync(path.join(root, 'examples', f), path.join(out, 'examples', f));
fs.writeFileSync(path.join(out, `clause-lab-v${pkg.version}.html`), final);
console.log(`dist/clause-lab.html + dist/clause-lab-v${pkg.version}.html`, (final.length / 1024 / 1024).toFixed(2), 'MB');
