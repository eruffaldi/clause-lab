// Generates examples/example-standard.pdf: a fictional, freely redistributable document laid out like a
// standard (cover, contents, foreword, numbered clauses, terms, "shall" lists, notes, a table, a figure,
// an annex, a bibliography, running headers/footers). All text is original synthetic content.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';

const W = 595.28, H = 841.89, L = 70, R = 525, TOP = 92, BOTTOM = 770;
const DESIG = 'STD 12345:2024';

type Block =
  | { t: 'h'; text: string; size?: number }
  | { t: 'p'; text: string; size?: number; indent?: number }
  | { t: 'li'; mark: string; text: string }
  | { t: 'note'; text: string }
  | { t: 'term'; num: string; term: string; def: string; extra?: string[] }
  | { t: 'gap'; h: number }
  | { t: 'center'; text: string; size: number; bold?: boolean }
  | { t: 'table'; caption: string; cols: number[]; rows: string[][] }
  | { t: 'figure'; caption: string; boxes: string[] }
  | { t: 'break' };

async function main(): Promise<void> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${DESIG} Example widgets — Life cycle processes (synthetic example)`);
  doc.setAuthor('Clause Lab example generator');
  doc.setCreationDate(new Date('2024-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2024-01-01T00:00:00Z'));
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page: PDFPage;
  let y = TOP;
  let pageNo = 0;
  const newPage = (withHeader = true): void => {
    page = doc.addPage([W, H]);
    pageNo++;
    y = TOP;
    if (withHeader) {
      const left = pageNo % 2 === 0;
      page.drawText(`${DESIG}(E)`, { x: left ? L : R - reg.widthOfTextAtSize(`${DESIG}(E)`, 9), y: H - 58, size: 9, font: reg });
      const num = `– ${pageNo} –`;
      page.drawText(num, { x: (W - reg.widthOfTextAtSize(num, 9)) / 2, y: H - 58, size: 9, font: reg });
    }
    const foot = 'Synthetic example document — free to copy and redistribute';
    page.drawText(foot, { x: L, y: 40, size: 7, font: ital, color: rgb(0.4, 0.4, 0.4) });
  };
  const text = (s: string, x: number, size: number, font: PDFFont): void => { page.drawText(s, { x, y: H - y, size, font }); };
  const ensure = (h: number): void => { if (y + h > BOTTOM) newPage(); };
  const wrap = (s: string, width: number, size: number, font: PDFFont): string[] => {
    const words = s.split(/\s+/); const out: string[] = []; let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > width && cur) { out.push(cur); cur = w; } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  };
  const para = (s: string, size = 10, indent = 0, font = reg, after = 6): void => {
    for (const ln of wrap(s, R - L - indent, size, font)) { ensure(size * 1.4); y += size * 1.1; text(ln, L + indent, size, font); y += size * 0.35; }
    y += after;
  };

  const render = (blocks: Block[]): void => {
    for (const b of blocks) {
      switch (b.t) {
        case 'break': newPage(); break;
        case 'gap': y += b.h; break;
        case 'h': { const s = b.size ?? 11; ensure(s * 4); y += 8; y += s; text(b.text, L, s, bold); y += 10; break; }
        case 'p': para(b.text, b.size ?? 10, b.indent ?? 0); break;
        case 'li': {
          const lines = wrap(b.text, R - L - 18, 10, reg);
          lines.forEach((ln, i) => { ensure(14); y += 11; if (i === 0) text(b.mark, L, 10, reg); text(ln, L + 18, 10, reg); y += 3.5; });
          y += 3; break;
        }
        case 'note': para(b.text, 9, 0, reg, 6); break;
        case 'term': {
          ensure(60); y += 6;
          y += 10; text(b.num, L, 10, bold); y += 4;
          y += 10; text(b.term, L, 10, bold); y += 4;
          para(b.def, 10, 0, reg, 4);
          (b.extra ?? []).forEach((e) => para(e, e.startsWith('Note') ? 9 : 10, 0, reg, 3));
          y += 6; break;
        }
        case 'center': { const f = b.bold ? bold : reg; ensure(b.size * 2); y += b.size; text(b.text, (W - f.widthOfTextAtSize(b.text, b.size)) / 2, b.size, f); y += b.size * 0.6; break; }
        case 'table': {
          ensure(40 + b.rows.length * 16);
          y += 6; y += 10; text(b.caption, (W - bold.widthOfTextAtSize(b.caption, 10)) / 2, 10, bold); y += 8;
          const xs = [L]; b.cols.forEach((c) => xs.push(xs[xs.length - 1] + c));
          const top = y;
          b.rows.forEach((row, ri) => {
            y += 12;
            row.forEach((cell, ci) => text(cell, xs[ci] + 4, 9, ri === 0 ? bold : reg));
            y += 5;
            page.drawLine({ start: { x: L, y: H - y }, end: { x: xs[xs.length - 1], y: H - y }, thickness: 0.5 });
          });
          xs.forEach((x) => page.drawLine({ start: { x, y: H - top }, end: { x, y: H - y }, thickness: 0.5 }));
          page.drawLine({ start: { x: L, y: H - top }, end: { x: xs[xs.length - 1], y: H - top }, thickness: 0.5 });
          y += 12; break;
        }
        case 'figure': {
          ensure(230);
          y += 10;
          const bw = 92, bh = 34, gap = 22;
          const total = b.boxes.length * bw + (b.boxes.length - 1) * gap;
          let x = (W - total) / 2;
          const by = y + 60;
          b.boxes.forEach((lab, i) => {
            page.drawRectangle({ x, y: H - by - bh, width: bw, height: bh, borderWidth: 1, borderColor: rgb(0.2, 0.2, 0.2), color: rgb(0.95, 0.95, 0.93) });
            page.drawText(lab, { x: x + (bw - reg.widthOfTextAtSize(lab, 8)) / 2, y: H - by - bh / 2 - 3, size: 8, font: reg });
            if (i < b.boxes.length - 1) page.drawLine({ start: { x: x + bw, y: H - by - bh / 2 }, end: { x: x + bw + gap, y: H - by - bh / 2 }, thickness: 1 });
            x += bw + gap;
          });
          page.drawRectangle({ x: L + 20, y: H - by - bh - 70, width: R - L - 40, height: bh + 120, borderWidth: 0.6, borderColor: rgb(0.6, 0.6, 0.6) });
          y = by + bh + 80;
          y += 10; text(b.caption, (W - bold.widthOfTextAtSize(b.caption, 10)) / 2, 10, bold); y += 14;
          break;
        }
      }
    }
  };

  // ---- cover (no running header) ----
  newPage(false);
  y = 200;
  render([
    { t: 'center', text: DESIG, size: 20, bold: true },
    { t: 'gap', h: 30 },
    { t: 'center', text: 'Example widgets — Life cycle processes', size: 16 },
    { t: 'gap', h: 200 },
    { t: 'center', text: 'Synthetic example for Clause Lab. Not a real standard.', size: 10 },
  ]);

  // ---- contents ----
  newPage();
  render([{ t: 'center', text: 'CONTENTS', size: 11, bold: true }, { t: 'gap', h: 10 }]);
  const toc = [['Foreword', 3], ['Introduction', 3], ['1 Scope', 4], ['2 Normative references', 4], ['3 Terms and definitions', 4], ['4 General requirements', 5], ['5 Widget development process', 6], ['Annex A (informative) Rationale', 8], ['Bibliography', 9]] as const;
  for (const [t, p] of toc) {
    y += 13;
    text(t, L, 10, reg);
    const dotsW = R - 20 - (L + reg.widthOfTextAtSize(t, 10) + 6);
    const dots = '.'.repeat(Math.max(3, Math.floor(dotsW / reg.widthOfTextAtSize('.', 10))));
    text(dots, L + reg.widthOfTextAtSize(t, 10) + 6, 10, reg);
    text(String(p), R - 10, 10, reg);
    y += 3;
  }

  // ---- body ----
  newPage();
  render([
    { t: 'center', text: 'FOREWORD', size: 11, bold: true }, { t: 'gap', h: 6 },
    { t: 'p', text: 'This document is a synthetic example prepared to exercise the Clause Lab indexer. Its numbering, headings, notes and requirement statements imitate the usual conventions of technical standards, while all wording is invented and carries no normative value.' },
    { t: 'p', text: 'Attention is drawn to the possibility that some of the elements of this example may resemble real documents only in their structure. No rights are claimed on that structure.' },
    { t: 'center', text: 'INTRODUCTION', size: 11, bold: true }, { t: 'gap', h: 6 },
    { t: 'p', text: 'Widgets are small configurable assemblies used in many products. A disciplined life cycle reduces the probability that a widget fault leads to an unsafe condition of the product that embeds it.' },
    { t: 'p', text: 'This example defines a minimum set of processes, activities and records. The requirements are deliberately short so that the regions produced by the indexer can be verified at a glance.' },
    { t: 'break' },
    { t: 'center', text: 'EXAMPLE WIDGETS – LIFE CYCLE PROCESSES', size: 12, bold: true }, { t: 'gap', h: 6 },
    { t: 'h', text: '1 Scope' },
    { t: 'p', text: 'This document specifies life cycle requirements for the development and maintenance of widgets. It applies to widgets delivered alone and to widgets integrated into a larger product.' },
    { t: 'h', text: '2 Normative references' },
    { t: 'p', text: 'There are no normative references in this document.' },
    { t: 'h', text: '3 Terms and definitions' },
    { t: 'p', text: 'For the purposes of this document, the following terms and definitions apply.' },
    { t: 'term', num: '3.1', term: 'widget', def: 'configurable assembly of parts that performs one function within a product', extra: ['Note 1 to entry: A widget can contain software.'] },
    { t: 'term', num: '3.2', term: 'activity', def: 'set of one or more interrelated tasks' },
    { t: 'term', num: '3.3', term: 'record', def: 'document stating results achieved or providing evidence of activities performed' },
    { t: 'term', num: '3.4', term: 'fault', def: 'abnormal condition that can cause a widget to fail to perform its function', extra: ['Note 1 to entry: A fault can be latent until a specific input occurs.'] },
    { t: 'term', num: '3.5', term: 'release', def: 'particular version of a widget made available for a specific purpose' },
    { t: 'term', num: '3.6', term: 'widget class', def: 'grouping of widgets according to the severity of the consequences of their faults' },
    { t: 'break' },
    { t: 'h', text: '4 General requirements' },
    { t: 'h', text: '4.1 Quality system', size: 10 },
    { t: 'p', text: 'The maker shall operate a quality system that covers the activities of this document. [Class A, B]' },
    { t: 'note', text: 'NOTE A quality system already in place for other products can be extended to widgets.' },
    { t: 'h', text: '4.2 Widget classification', size: 10 },
    { t: 'p', text: 'The maker shall assign a widget class to each widget. The assignment shall consider:' },
    { t: 'li', mark: 'a)', text: 'the worst credible consequence of a fault;' },
    { t: 'li', mark: 'b)', text: 'the measures outside the widget that limit that consequence;' },
    { t: 'li', mark: 'c)', text: 'the intended environment of use.' },
    { t: 'p', text: 'The maker shall record the rationale for the assigned class. [Class A, B]' },
    { t: 'note', text: 'NOTE 1 Class A widgets cannot contribute to an unsafe condition. Class B widgets can.' },
    { t: 'note', text: 'NOTE 2 The class can change after a modification; see 5.2.' },
    { t: 'h', text: '4.3 Records', size: 10 },
    { t: 'p', text: 'Records required by this document shall be retained for the lifetime of the product, e.g. in an electronic archive. [Class A, B]' },
    { t: 'break' },
    { t: 'h', text: '5 Widget development process' },
    { t: 'h', text: '5.1 Planning', size: 10 },
    { t: 'h', text: '5.1.1 Development plan', size: 10 },
    { t: 'p', text: 'The maker shall establish a development plan for each widget. The plan shall address the following:' },
    { t: 'li', mark: 'a)', text: 'the activities to be performed and their sequence;' },
    { t: 'li', mark: 'b)', text: 'the records to be produced;' },
    { t: 'li', mark: 'c)', text: 'the responsibilities for each activity.' },
    { t: 'p', text: '[Class A, B]' },
    { t: 'h', text: '5.1.2 Keep the plan updated', size: 10 },
    { t: 'p', text: 'The maker shall update the plan when the scope or the widget class changes. [Class B]' },
    { t: 'h', text: '5.1.3 Tools', size: 10 },
    { t: 'p', text: 'The plan shall identify the tools used to design, build and test the widget, including their versions. [Class B]' },
    { t: 'table', caption: 'Table 1 – Minimum records by widget class', cols: [180, 135, 140], rows: [['Record', 'Class A', 'Class B'], ['Development plan', 'required', 'required'], ['Classification rationale', 'required', 'required'], ['Tool list', '—', 'required'], ['Test report', 'summary', 'detailed']] },
    { t: 'h', text: '5.2 Modification', size: 10 },
    { t: 'p', text: 'Modifications to a released widget follow the same process as the original development, scaled to the size of the change. This subclause is intentionally long so that it continues on the following page and the indexer has to draw a region that crosses a page boundary.' },
    { t: 'p', text: 'The maker shall analyse each requested modification before implementing it. The analysis shall identify the parts of the widget affected, the records to be updated and whether the widget class remains valid.' },
    { t: 'p', text: 'When a modification is approved, the maker shall implement it, verify it and update the affected records. Verification shall include a repetition of the tests that could be influenced by the modification.' },
    { t: 'note', text: 'NOTE 1 A repetition of all tests is acceptable when the influence of the modification cannot be bounded.' },
    { t: 'p', text: 'The maker shall inform the users of the widget about each new release and about known faults that remain in it. [Class B]' },
    { t: 'note', text: 'NOTE 2 Information can be provided in release notes, labels or electronic notices.' },
    { t: 'p', text: 'Additional guidance for modifications is given in A.2. The following paragraphs describe a typical sequence of events that leads from a field observation to a new release; they are informative.' },
    { t: 'p', text: 'A field observation is reported by a user. The maker evaluates whether the observation reveals a fault. If it does, a modification request is opened and analysed as described above. The modification is then implemented, verified and released together with updated records and user information.' },
    { t: 'figure', caption: 'Figure 1 – Typical modification sequence', boxes: ['Field observation', 'Analysis', 'Implementation', 'Release'] },
    { t: 'p', text: 'The maker shall keep the records of each modification together with the records of the release that contains it. [Class A, B]' },
    { t: 'break' },
    { t: 'center', text: 'Annex A', size: 12, bold: true },
    { t: 'center', text: '(informative)', size: 12 },
    { t: 'gap', h: 6 },
    { t: 'center', text: 'Rationale', size: 12, bold: true },
    { t: 'gap', h: 10 },
    { t: 'h', text: 'A.1 General', size: 10 },
    { t: 'p', text: 'This annex explains the reasons behind selected requirements. It does not add requirements.' },
    { t: 'h', text: 'A.2 Modifications', size: 10 },
    { t: 'p', text: 'Most faults found after release originate from modifications. Repeating the influenced tests (see 5.2) is the most effective single measure; Table A.1 summarises the effort usually spent.' },
    { t: 'table', caption: 'Table A.1 – Typical verification effort', cols: [220, 235], rows: [['Size of modification', 'Share of tests repeated'], ['Configuration only', 'about 10 %'], ['Local code change', 'about 30 %'], ['Interface change', 'up to 100 %']] },
    { t: 'h', text: 'A.3 Classification', size: 10 },
    { t: 'p', text: 'Two classes are enough for most widgets. A finer classification rarely changes the activities performed and makes the assignment harder to justify.' },
    { t: 'break' },
    { t: 'center', text: 'Bibliography', size: 12, bold: true },
    { t: 'gap', h: 8 },
    { t: 'p', text: '[1] Example Society, Handbook of widget design, 3rd edition, fictional reference.' },
    { t: 'p', text: '[2] Example Society, Guide to field observation reporting, fictional reference.' },
  ]);

  const out = path.join(process.cwd(), 'examples', 'example-standard.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await doc.save({ useObjectStreams: false }));
  console.log(`${out} (${pageNo} pages)`);
}

void main();
