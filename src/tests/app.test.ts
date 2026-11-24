import { describe, expect, it } from 'vitest';
import { analyze, isSuccessor, joinLines, shallSentences } from '../core/analyze';
import { buildLines, charX } from '../core/lines';
import { buildReport, citation, hitTest, searchItems } from '../core/query';
import type { RawItem, RawPage } from '../core/types';
import { pageCrop, rectToCss, scrollPlan } from '../app/viewer';
import { normalizeScrollMotion } from '../app/store';
import { isCurrentAnalysis, normalizeIndex } from '../core/schema';

// ---- synthetic standard-like document builder ----
const W = 595, H = 842;
function page(no: number, lines: (string | [string, number] | [string, number, number])[], extra: RawItem[] = []): RawPage {
  const items: RawItem[] = [
    { str: 'STD 99999:2024(E)', x: 70, y: 50, w: 90, size: 9, font: 'f' },
    { str: `– ${no + 10} –`, x: 280, y: 50, w: 30, size: 9, font: 'f' },
    { str: 'Licensed copy, not for resale', x: 70, y: 820, w: 150, size: 7, font: 'f' },
  ];
  let y = 90;
  for (const l of lines) {
    const [str, size, x] = typeof l === 'string' ? [l, 10, 70] : [l[0], l[1], l[2] ?? 70];
    items.push({ str, x, y, w: Math.min(455, str.length * size * 0.5), size, font: 'f' });
    y += size * 1.45;
  }
  return { page: no, width: W, height: H, items: [...items, ...extra] };
}
let ctr = 0;
const word = (k: number): string => { let s = ''; do { s += String.fromCharCode(97 + (k % 26)); k = Math.floor(k / 26); } while (k); return s; };
const filler = (n: number): string[] => Array.from({ length: n }, () => `Body text ${word(ctr++)} with enough words to look like a normal paragraph of the standard here.`);

function sampleDoc(): RawPage[] {
  return [
    page(1, ['Foreword', ...filler(8)]),
    page(2, ['1 Scope', ...filler(3), '2 Normative references', ...filler(2), '3 Terms and definitions', '3.1', ['risk', 10], 'combination of the probability of occurrence of harm', '3.2', ['harm', 10], 'injury or damage to the health of people']),
    page(3, ['4 General requirements', '4.1 Process', 'The maker shall establish a process. The process shall include:', 'a) planning;', 'b) review.', 'NOTE The process can be documented.', ...filler(16)]),
    page(4, [...filler(6), '4.2 Records', 'Records shall be maintained.', 'Table 1 – Record types', ['Record   Retention   Owner', 9], ['Plan    5 years    QA', 9], ...filler(4)]),
    page(5, [['Annex A', 12, 270], ['(informative)', 12, 262], ['Rationale', 12, 250], 'A.1 General', ...filler(6), 'A.2 Details', ...filler(4), ['Figure A.1 – Overview', 10, 200]]),
    page(6, ['Bibliography', '[1] STD 9000', ...filler(5)]),
  ];
}

describe('SSR-011 line building', () => {
  it('SSR-011 groups runs by baseline and joins small caps without a space', () => {
    const p: RawPage = { page: 1, width: W, height: H, items: [
      { str: '4.2 * R', x: 70, y: 100, w: 30, size: 10, font: 'b' },
      { str: ' ', x: 100, y: 100, w: 0.05, size: 10, font: 'b' },
      { str: 'ISK MANAGEMENT', x: 100.1, y: 100, w: 70, size: 8, font: 'b' },
      { str: 'next line', x: 70, y: 115, w: 40, size: 10, font: 'r' },
    ] };
    const ls = buildLines(p);
    expect(ls.map((l) => l.text)).toEqual(['4.2 * RISK MANAGEMENT', 'next line']);
    expect(ls[0].maxSize).toBe(10);
  });
  it('SSR-011 inserts spaces only across real gaps and maps characters to x', () => {
    const p: RawPage = { page: 1, width: W, height: H, items: [
      { str: 'abc', x: 10, y: 50, w: 30, size: 10, font: 'r' },
      { str: 'def', x: 45, y: 50, w: 30, size: 10, font: 'r' },
    ] };
    const [l] = buildLines(p);
    expect(l.text).toBe('abc def');
    expect(charX(l, 0)).toBe(10);
    expect(charX(l, 7)).toBe(75);
  });
});

describe('SSR-013 heading numbering', () => {
  it('SSR-013 accepts valid successors and rejects jumps', () => {
    expect(isSuccessor([], [0, 1])).toBe(true);
    expect(isSuccessor([0, 1], [0, 2])).toBe(true);
    expect(isSuccessor([], [1])).toBe(true);
    expect(isSuccessor([5, 1, 1], [5, 1, 2])).toBe(true);
    expect(isSuccessor([5, 1, 12], [5, 2])).toBe(true);
    expect(isSuccessor([5, 2], [5, 2, 1])).toBe(true);
    expect(isSuccessor([5, 2], [6])).toBe(true);
    expect(isSuccessor([5, 2], [90000])).toBe(false);
    expect(isSuccessor([5, 2], [5, 2, 3])).toBe(false);
    expect(isSuccessor([3], [2015])).toBe(false);
    expect(isSuccessor([], [201, 1])).toBe(true);
    expect(isSuccessor([201, 17], [202])).toBe(true);
    expect(isSuccessor([202], [206])).toBe(true);
    expect(isSuccessor([201, 4, 3], [201, 4, 6])).toBe(true);
    expect(isSuccessor([201, 5, 4], [201, 5, 7])).toBe(true);
  });
});

describe('SSR-016/017 text', () => {
  it('SSR-016 joins lines, de-hyphenates and keeps list items on new lines', () => {
    expect(joinLines(['The develop-', 'ment plan shall', 'include:', 'a) x;', 'b) y.'])).toBe('The development plan shall include:\na) x;\nb) y.');
  });
  it('SSR-017 finds shall sentences including list continuation and class markers', () => {
    const s = 'Intro text. The plan shall include:\na) x;\nb) y. Other text. It shall be done. [Class A, B, C] Next.';
    const r = shallSentences(s).map((x) => s.slice(x.start, x.end));
    expect(r).toEqual(['The plan shall include:\na) x;\nb) y.', 'It shall be done. [Class A, B, C]']);
  });
  it('SSR-017 ignores abbreviations and NOTE paragraphs', () => {
    const s = 'Tools, e.g. compilers, shall be listed.\nNOTE This shall not count.';
    expect(shallSentences(s).map((x) => s.slice(x.start, x.end))).toEqual(['Tools, e.g. compilers, shall be listed.']);
  });
});

describe('SR-010 analysis of a synthetic standard', () => {
  const idx = analyze(sampleDoc(), { fileName: 'std99999.pdf', sha256: 'abc' });
  const by = (num: string) => idx.items.find((i) => i.num === num)!;

  it('SSR-012 removes headers/footers and reads printed page labels', () => {
    expect(idx.items.every((i) => !/Licensed copy/.test(i.text))).toBe(true);
    expect(idx.pageLabels[2]).toBe('13');
    expect(idx.source.designation).toBe('STD 99999:2024');
  });
  it('SSR-021 computes a crop box tighter than the page', () => {
    expect(idx.crop.x0).toBeGreaterThan(30);
    expect(idx.crop.y0).toBeGreaterThan(55);
    expect(idx.crop.y1).toBeLessThan(815);
  });
  it('SR-011 indexes clauses, definitions, annexes, sections', () => {
    expect(by('1').title).toBe('Scope');
    expect(by('3.1').kind).toBe('definition');
    expect(by('3.1').title).toBe('risk');
    expect(by('3.2').text).toContain('injury or damage');
    expect(by('A').kind).toBe('annex');
    expect(by('A').title).toBe('Rationale (informative)');
    expect(by('A.2').parent).toBe(by('A').id);
    expect(idx.items.some((i) => i.kind === 'section' && i.title === 'Bibliography')).toBe(true);
  });
  it('SR-012 clause regions continue across pages (4.1 spans pages 3-4)', () => {
    const c = by('4.1');
    expect(c.regions.map((r) => r.page)).toEqual([3, 4]);
    expect(by('4').full!.map((r) => r.page)).toEqual([3, 4]);
  });
  it('SR-013 indexes tables, figures and shall statements', () => {
    expect(by('Table 1').kind).toBe('table');
    expect(by('Table 1').parent).toBe(by('4.2').id);
    expect(by('Figure A.1').regions[0].page).toBe(5);
    const reqs = idx.items.filter((i) => i.kind === 'requirement' && i.parent === by('4.1').id);
    expect(reqs.map((r) => r.text)).toEqual(['The maker shall establish a process.', 'The process shall include:\na) planning;\nb) review.']);
  });
  it('SR-025 search by number returns the item and its children first', () => {
    const kinds = new Set(['clause', 'definition', 'annex', 'table', 'figure', 'section', 'requirement'] as const);
    const r = searchItems(idx.items, 'doc', new Set(kinds), '4.1');
    expect(r[0].num).toBe('4.1');
    expect(r.every((i) => i.num === '4.1' || i.num.startsWith('4.1/'))).toBe(true);
    expect(searchItems(idx.items, 'doc', new Set(kinds), 'harm')[0].num).toBe('3.2');
  });
  it('SR-026 hit test prefers the most specific item', () => {
    const r = by('3.1').regions[0];
    expect(hitTest(idx.items, 'doc', 2, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, false)!.num).toBe('3.1');
  });
  it('SR-032 citation uses designation, number, title and printed page', () => {
    expect(citation(idx, by('3.1'))).toBe('STD 99999:2024, 3.1 risk, p. 12');
    expect(citation(idx, by('4.1'))).toMatch(/4\.1 Process, pp\. 13–14$/);
  });
  it('SR-033 report contains escaped citations, notes and status table', () => {
    const html = buildReport(idx, [{ item: by('3.1'), full: false, note: 'gap <x>', status: 'gap', text: 'risk text', img: null }], { title: 'T', includeText: true, includeImages: true });
    expect(html).toContain('STD 99999:2024, 3.1 risk');
    expect(html).toContain('gap &lt;x&gt;');
    expect(html).toContain('<table class="sum">');
  });
  it('SR-022 maps rectangles into the cropped page box', () => {
    const c = pageCrop(idx, 2);
    const css = rectToCss({ page: 2, x0: c.x0 + 10, y0: c.y0 + 20, x1: c.x0 + 110, y1: c.y0 + 70 }, c, 2);
    expect(css).toEqual({ left: 20, top: 40, width: 200, height: 100 });
  });
});

describe('SR-014 multi-part documents', () => {
  it('SR-014 splits redline and final parts and defaults to final', () => {
    const d = [page(1, [['REDLINE VERSION', 14, 200]]), ...sampleDoc().slice(0, 3).map((p, i) => ({ ...p, page: i + 2 })),
      page(5, [['FINAL VERSION', 14, 200]]), ...sampleDoc().slice(0, 3).map((p, i) => ({ ...p, page: i + 6 }))];
    const idx = analyze(d, { fileName: 'x.pdf', sha256: 'y' });
    expect(idx.parts.map((p) => p.id)).toEqual(['redline', 'final']);
    expect(idx.defaultPart).toBe('final');
    expect(idx.items.filter((i) => i.num === '3.1').map((i) => i.part)).toEqual(['redline', 'final']);
  });

  describe('particular standards and bilingual editions', () => {
    it('indexes 201.x clauses, skipped top-level numbers and annexes without A', () => {
      const idx = analyze([
        page(1, ['Foreword', '201.1 Scope', '201.2 Normative references', '201.3 Terms and definitions',
          '201.3.201', 'additional term', 'Definition of the additional term.', '201.3.202 Defined item',
          '202 Medical electrical equipment', '206 General requirements']),
        page(2, ['Annex D', '(informative)', 'Specific guidance', 'D.1 General', 'Annex AA', 'Additional requirements', 'AA.1 Scope']),
      ], { fileName: 'particular-standard.pdf', sha256: 'particular' });

      expect(idx.items.filter((i) => ['clause', 'definition'].includes(i.kind)).map((i) => i.num))
        .toEqual(['201.1', '201.2', '201.3', '201.3.201', '201.3.202', '202', '206']);
      expect(idx.items.filter((i) => i.kind === 'annex').map((i) => i.num)).toEqual(['D', 'D.1', 'AA', 'AA.1']);
    });

    it('leaves an early European annex before indexing coded clause headings', () => {
      const idx = analyze([
        page(1, ['Annex ZA', '(normative)', 'Normative references to international publications']),
        page(2, ['Foreword', '0.1 Overview', 'Introductory material.']),
        page(3, ['1 Scope', '2 Normative references', '3 Terms and definitions']),
        page(4, ['3.1 Terms and definitions', '3.1.1', 'asset', 'an item with value']),
        page(5, ['4 Common component security constraints', '4.1 Overview',
          '5 FR 1 – Identification and authentication control',
          '5.1 Purpose', '5.2 Rationale']),
        page(6, ['5.3 CR 1.1 – Human user identification and authentication',
          '5.3.1 Requirement', 'Components shall identify all human users.']),
        page(7, ['5.4 CR 1.2 – Software process identification and authentication']),
      ], { fileName: 'coded-standard.pdf', sha256: 'front-annex' });

      expect(idx.items.filter((i) => i.kind === 'annex').map((i) => i.num)).toEqual(['ZA']);
      expect(idx.items.filter((i) => i.kind === 'clause').map((i) => i.num))
        .toEqual(['0.1', '1', '2', '3', '3.1', '4', '4.1', '5', '5.1', '5.2', '5.3', '5.3.1', '5.4']);
      expect(idx.items.find((i) => i.num === '5.3')?.title)
        .toBe('CR 1.1 – Human user identification and authentication');
      expect(idx.items.find((i) => i.num === '5.3.1/R1')?.parent).toBe('doc:5.3.1');
    });

    it('keeps lifecycle practice codes in their numeric heading titles', () => {
      const idx = analyze([
        page(1, ['1 Scope', '2 Normative references', '3 Terms and definitions', '4 General principles',
          '5 Practice 1 – Security management', '5.1 Purpose',
          '5.2 SM-1: Development process', '5.2.1 Requirement',
          'A product development process shall be documented.']),
      ], { fileName: 'lifecycle-standard.pdf', sha256: 'codes' });

      expect(idx.items.find((i) => i.num === '5.2')?.title).toBe('SM-1: Development process');
      expect(idx.items.find((i) => i.num === '5.2.1/R1')?.text)
        .toContain('development process shall be documented');
    });

    it('does not remove frequently repeated structural subheadings as page noise', () => {
      const pages = [page(1, ['1 Practice', ...filler(3)])];
      for (let n = 1; n <= 20; n++) {
        pages.push(page(n + 1, [`1.${n} Requirement`, `A process shall complete the ${word(n)} procedure.`]));
      }
      const idx = analyze(pages, { fileName: 'repeated-headings.pdf', sha256: 'headings' });

      expect(idx.items.find((i) => i.num === '1.20')?.title).toBe('Requirement');
      expect(idx.items.find((i) => i.num === '1.20/R1')?.text).toContain('complete the');
    });

    it('keeps the English edition when a French duplicate follows it', () => {
      const english = [
        page(1, ['CONTENTS', '201.1 Scope ................................ 2']),
        page(2, ['201.1 Scope', 'This is the English scope.', ...filler(5)]),
        page(3, ['Bibliography', '[1] STD 90000-1']),
      ];
      const french = [
        page(4, ['SOMMAIRE', '201.1 Domaine d’application ........................ 2']),
        page(5, ['201.1 Domaine d’application', 'Ceci est le domaine français.']),
        page(6, ['AVANT-PROPOS', 'Texte en français.']),
      ];
      const idx = analyze([...english, ...french], { fileName: 'bilingual.pdf', sha256: 'fr' });

      expect(idx.source.pages).toBe(6);
      expect(idx.parts).toEqual([{ id: 'doc', label: 'Document', pageStart: 1, pageEnd: 3 }]);
      expect(idx.items.some((i) => i.text.includes('English scope'))).toBe(true);
      expect(idx.items.every((i) => i.page <= 3)).toBe(true);
    });

    it('does not truncate a French-only or ordinary document on French section words', () => {
      const frenchOnly = analyze([
        page(1, ['AVANT-PROPOS', 'Préface française']),
        page(2, ['SOMMAIRE', '201.1 Domaine d’application']),
      ], { fileName: 'fr.pdf', sha256: 'fr-only' });
      expect(frenchOnly.parts[0].pageEnd).toBe(2);

      const ordinary = analyze([...sampleDoc(), page(7, ['Appendix note', 'An unrelated final note'])],
        { fileName: 'ordinary.pdf', sha256: 'ordinary' });
      expect(ordinary.parts[0].pageEnd).toBe(7);
    });
  });
});

describe('SR-050..052 versioning', () => {
  it('SR-050 app version is semver from package.json and stamped into the index', async () => {
    const { APP_VERSION, ANALYZER_VERSION } = await import('../version');
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const idx = analyze(sampleDoc(), { fileName: 'a.pdf', sha256: 'h' });
    expect(idx.format).toBe('clause-index');
    expect(idx.version).toBe(2);
    expect(idx.generator).toEqual({ app: 'clause-lab', version: APP_VERSION, analyzer: ANALYZER_VERSION });
    expect(buildReport(idx, [], { title: 't', includeText: true, includeImages: false })).toContain(`Clause Lab v${APP_VERSION}`);
  });

  describe('entry scroll motion', () => {
    it('normalizes persisted motion settings', () => {
      expect(normalizeScrollMotion('none')).toBe('none');
      expect(normalizeScrollMotion('peek')).toBe('peek');
      expect(normalizeScrollMotion('invalid')).toBe('full');
    });
    it('smoothly scrolls or jumps for the direct motion modes', () => {
      expect(scrollPlan(100, 1800, 'full')).toEqual([{ top: 1800, behavior: 'smooth', delay: 0 }]);
      expect(scrollPlan(100, 1800, 'none')).toEqual([{ top: 1800, behavior: 'auto', delay: 0 }]);
    });
    it('cues the direction before jumping without scrolling a short distance twice', () => {
      expect(scrollPlan(1000, 2000, 'peek')).toEqual([
        { top: 1072, behavior: 'smooth', delay: 0 },
        { top: 2000, behavior: 'auto', delay: 120 },
      ]);
      expect(scrollPlan(1000, 0, 'peek')[0].top).toBe(928);
      expect(scrollPlan(100, 150, 'peek')).toEqual([{ top: 150, behavior: 'auto', delay: 0 }]);
    });
  });
  it('SR-051 loads and upgrades schema v1 index files, rejects newer or foreign files', () => {
    const v1 = { ...analyze(sampleDoc(), { fileName: 'a.pdf', sha256: 'h' }), format: 'legacy-clause-index', version: 1 } as Record<string, unknown>;
    delete v1.generator;
    const up = normalizeIndex(v1);
    expect(up.format).toBe('clause-index');
    expect(up.version).toBe(2);
    expect(up.generator.analyzer).toBe(1);
    expect(isCurrentAnalysis(up)).toBe(false);
    expect(() => normalizeIndex({ ...v1, version: 99 })).toThrow(/newer/);
    expect(() => normalizeIndex({ format: 'something-else', version: 1 })).toThrow(/not a Clause Lab index/);
  });
  it('SR-052 cached index is reused only for the current analyzer revision', () => {
    const idx = analyze(sampleDoc(), { fileName: 'a.pdf', sha256: 'h' });
    expect(isCurrentAnalysis(idx)).toBe(true);
    expect(isCurrentAnalysis({ ...idx, generator: { ...idx.generator, analyzer: 0 } })).toBe(false);
  });
});
