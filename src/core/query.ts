// Pure helpers used by the UI: search, hit testing, citations, report (SR-025, SR-030..SR-033).
import type { ClauseIndex, IndexItem, ItemKind } from './types';
import { APP_VERSION } from '../version';

export const KIND_LABEL: Record<ItemKind, string> = {
  section: 'Section', clause: 'Clause', definition: 'Definition', annex: 'Annex',
  table: 'Table', figure: 'Figure', requirement: 'Shall',
};

/** SSR-025: filter items of a part by kinds and free-text query (number prefix or words). */
export function searchItems(items: IndexItem[], part: string, kinds: Set<ItemKind>, q: string): IndexItem[] {
  const qq = q.trim().toLowerCase();
  const base = items.filter((it) => it.part === part && kinds.has(it.kind));
  if (!qq) return base;
  // number query: "5.1.1", "a.2", "table a.1", "3.10" -> the item and its sub-items only
  const numQ = qq.replace(/\.$/, '');
  if (/^((table|figure|annex)\s+)?([a-z]{1,2}\.)?\d+(\.\d+)*$|^annex\s+[a-z]{1,2}$/.test(numQ)) {
    const key = numQ.replace(/^annex\s+/, '');
    const hit = (n: string): number => (n === key ? 0 : n.startsWith(key + '.') || n.startsWith(key + '/') ? 1 : -1);
    return base.map((it) => ({ it, r: hit(it.num.toLowerCase()) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r).map((x) => x.it);
  }
  const terms = qq.split(/\s+/).filter(Boolean);
  const scored = base.map((it) => {
    const title = `${it.num} ${it.title}`.toLowerCase();
    const hay = `${title} ${it.text}`.toLowerCase();
    if (!terms.every((t) => hay.includes(t))) return null;
    return { it, r: terms.every((t) => title.includes(t)) ? 0 : 1 };
  }).filter((x): x is { it: IndexItem; r: number } => !!x);
  return scored.sort((a, b) => a.r - b.r).map((x) => x.it);
}

/** SSR-026: the most specific item whose region contains a page point. */
export function hitTest(items: IndexItem[], part: string, page: number, x: number, y: number, includeReq: boolean): IndexItem | null {
  const rank: Record<ItemKind, number> = { requirement: 0, definition: 1, table: 1, figure: 1, clause: 2, annex: 2, section: 3 };
  let best: IndexItem | null = null, bestScore = Infinity;
  for (const it of items) {
    if (it.part !== part || (!includeReq && it.kind === 'requirement')) continue;
    for (const r of it.regions) {
      if (r.page !== page || x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
      const score = rank[it.kind] * 1e7 + (r.x1 - r.x0) * (r.y1 - r.y0);
      if (score < bestScore) { bestScore = score; best = it; }
    }
  }
  if (best) return best;
  // gap between regions: take the nearest non-requirement region on the page (vertical distance)
  let near: IndexItem | null = null, nd = 40;
  for (const it of items) {
    if (it.part !== part || it.kind === 'requirement') continue;
    for (const r of it.regions) {
      if (r.page !== page || x < r.x0 - 20 || x > r.x1 + 20) continue;
      const d = y < r.y0 ? r.y0 - y : y > r.y1 ? y - r.y1 : 0;
      if (d < nd || (d === nd && near && rank[it.kind] < rank[near.kind])) { nd = d; near = it; }
    }
  }
  return near;
}

export function pageRef(idx: ClauseIndex, it: IndexItem, full: boolean): string {
  const rs = full && it.full ? it.full : it.regions;
  const pages = [...new Set(rs.map((r) => r.page))];
  const lab = (p: number): string => idx.pageLabels[p - 1] || `PDF ${p}`;
  if (!pages.length) return '';
  return pages.length === 1 ? `p. ${lab(pages[0])}` : `pp. ${lab(pages[0])}–${lab(pages[pages.length - 1])}`;
}

/** SR-032: human citation, e.g. "STD 12345:2006+AMD1:2015, 5.1.1 Development plan, p. 18". */
export function citation(idx: ClauseIndex, it: IndexItem, full = false): string {
  const d = idx.source.designation;
  const where = it.kind === 'requirement' ? `${it.num.split('/')[0]} (requirement ${it.num.split('/')[1]})`
    : it.kind === 'annex' && !it.num.includes('.') ? `Annex ${it.num}`
      : it.kind === 'section' ? it.title
        : it.num;
  const title = it.kind === 'requirement' || it.kind === 'section' ? '' : ` ${it.title}`;
  return `${d}, ${where}${title}${full && it.full ? ' (incl. subclauses)' : ''}, ${pageRef(idx, it, full)}`;
}

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface ReportEntry { item: IndexItem; full: boolean; note: string; status: string; text: string; img: string | null }

/** SR-033: self-contained printable HTML report of the basket. */
export function buildReport(idx: ClauseIndex, entries: ReportEntry[], opts: { title: string; includeText: boolean; includeImages: boolean }): string {
  const rows = entries.map((e, i) => `
<section class="it">
  <h2><span class="n">${i + 1}</span> ${esc(citation(idx, e.item, e.full))}</h2>
  <div class="meta">${esc(e.item.kind)}${e.status ? ` · <b class="st st-${esc(e.status)}">${esc(e.status)}</b>` : ''}</div>
  ${e.note ? `<div class="note">${esc(e.note).replace(/\n/g, '<br>')}</div>` : ''}
  ${opts.includeText ? `<blockquote>${esc(e.text)}</blockquote>` : ''}
  ${opts.includeImages && e.img ? `<img alt="${esc(e.item.num)}" src="${e.img}">` : ''}
</section>`).join('\n');
  const gap = entries.some((e) => e.status) ? `
<table class="sum"><tr><th>#</th><th>Reference</th><th>Status</th><th>Note</th></tr>
${entries.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.item.num || e.item.title)}</td><td>${esc(e.status)}</td><td>${esc(e.note)}</td></tr>`).join('')}
</table>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title>
<style>
body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1d1d1f}
h1{font-size:20px;margin:0 0 4px}.src{color:#666;font-size:12px;margin-bottom:18px}
.it{border-top:1px solid #ddd;padding:14px 0;break-inside:avoid-page}
h2{font-size:15px;margin:0 0 4px}.n{display:inline-block;min-width:22px;color:#b3261e}
.meta{font-size:12px;color:#777;margin-bottom:6px}.note{background:#fff8e1;border-left:3px solid #f2b705;padding:6px 10px;margin:6px 0}
blockquote{white-space:pre-wrap;margin:6px 0;padding:6px 12px;border-left:3px solid #b3261e;background:#fafafa;font-size:13px}
img{max-width:100%;border:1px solid #ccc;margin-top:6px}
.sum{border-collapse:collapse;width:100%;font-size:12px;margin:10px 0 20px}.sum td,.sum th{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
.st-gap{color:#b3261e}.st-partial{color:#b26b00}.st-covered{color:#1b7f3b}
.bar{position:sticky;top:0;background:#fff;padding:6px 0;border-bottom:1px solid #eee;margin-bottom:10px}
@media print{.bar{display:none}body{margin:0}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>
<h1>${esc(opts.title)}</h1>
<div class="src">Source: ${esc(idx.source.designation)} — ${esc(idx.source.fileName)} (sha256 ${esc(idx.source.sha256.slice(0, 12))}…) · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} by Clause Lab v${esc(APP_VERSION)}${idx.generator ? ` (index: v${esc(idx.generator.version)}, analyzer r${idx.generator.analyzer})` : ''}</div>
${gap}
${rows}
</body></html>`;
}
