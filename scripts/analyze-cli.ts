// Dev tool: run the analyzer in Node on a PDF and write the JSON index.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { analyze } from '../src/core/analyze';
import { extractPage, type PjsPage } from '../src/core/extract';

const [, , inFile, outFile] = process.argv;
const buf = fs.readFileSync(inFile);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
const pages = [];
for (let i = 1; i <= doc.numPages; i++) pages.push(await extractPage((await doc.getPage(i)) as unknown as PjsPage, i));
const idx = analyze(pages, { fileName: path.basename(inFile), sha256: sha });
fs.writeFileSync(outFile, JSON.stringify(idx));
console.log(`clause-lab v${idx.generator.version} analyzer r${idx.generator.analyzer}`, 'items', idx.items.length, 'parts', JSON.stringify(idx.parts), 'crop', JSON.stringify(idx.crop), idx.source.designation);
