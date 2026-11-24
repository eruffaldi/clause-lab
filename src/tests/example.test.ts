// SR-060: the shipped example (synthetic, redistributable) is analysed end-to-end and its index is up to date.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { analyze } from '../core/analyze';
import { extractPage, type PjsPage } from '../core/extract';
import { normalizeIndex } from '../core/schema';
import type { ClauseIndex } from '../core/types';

const PDF = 'examples/example-standard.pdf';
const IDX = 'examples/example-standard.clause-index.json';

async function run(): Promise<ClauseIndex> {
  const buf = fs.readFileSync(PDF);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push(await extractPage((await doc.getPage(i)) as unknown as PjsPage, i));
  return analyze(pages, { fileName: 'example-standard.pdf', sha256: crypto.createHash('sha256').update(buf).digest('hex') });
}

describe('SR-060 example document', async () => {
  const idx = await run();
  const by = (num: string) => idx.items.find((i) => i.num === num)!;

  it('SR-060 indexes the expected structure of the example', () => {
    expect(idx.source.designation).toBe('STD 12345:2024');
    expect(idx.items.filter((i) => i.kind === 'definition').map((i) => i.title)).toEqual(['widget', 'activity', 'record', 'fault', 'release', 'widget class']);
    expect(idx.items.filter((i) => i.kind === 'clause').map((i) => i.num)).toEqual(['1', '2', '3', '4', '4.1', '4.2', '4.3', '5', '5.1', '5.1.1', '5.1.2', '5.1.3', '5.2']);
    expect(idx.items.filter((i) => i.kind === 'annex').map((i) => i.num)).toEqual(['A', 'A.1', 'A.2', 'A.3']);
    expect(['Table 1', 'Figure 1', 'Table A.1'].every((n) => by(n))).toBe(true);
    expect(idx.items.filter((i) => i.kind === 'requirement')).toHaveLength(15);
    expect(idx.pageLabels[5]).toBe('6');
  });
  it('SR-060 clause 5.2 region crosses a page break; contents page is not indexed', () => {
    expect(by('5.2').regions.map((r) => r.page)).toEqual([6, 7]);
    expect(idx.items.every((i) => i.page !== 2)).toBe(true);
  });
  it('SR-060 requirement text excludes figure content and keeps list items and class markers', () => {
    expect(by('5.2/R6').text).toBe('The maker shall keep the records of each modification together with the records of the release that contains it. [Class A, B]');
    expect(by('4.2/R2').text).toBe('The assignment shall consider:\na) the worst credible consequence of a fault;\nb) the measures outside the widget that limit that consequence;\nc) the intended environment of use.');
  });
  it('SR-060 committed example index matches a fresh analysis (run `make example` after analyzer changes)', () => {
    const committed = normalizeIndex(JSON.parse(fs.readFileSync(IDX, 'utf8')));
    const strip = (x: ClauseIndex) => ({ ...x, createdAt: '', source: { ...x.source, fileName: '' }, generator: { ...x.generator, version: '' } });
    expect(strip(committed)).toEqual(strip(idx));
  });
});

describe('SR-061 repository content', () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    if (['node_modules', 'dist', '.git'].includes(e.name)) return [];
    const p = `${d}/${e.name}`;
    return e.isDirectory() ? walk(p) : [p];
  });
  it('SR-061 only the synthetic example PDF and its index are in the repository', async () => {
    const docs = walk('.').filter((f) => /\.pdf$|clause-index\.json$/i.test(f)).sort();
    expect(docs).toEqual(['./examples/example-standard.clause-index.json', './examples/example-standard.pdf']);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(PDF)), verbosity: 0 }).promise;
    const meta = await doc.getMetadata();
    expect((meta.info as { Author?: string }).Author).toBe('Clause Lab example generator');
  });
});
