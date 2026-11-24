import { buildLines, charX } from './lines';
import type { ClauseIndex, IndexItem, ItemKind, Line, Part, RawPage, Rect } from './types';
import { ANALYZER_VERSION, APP_NAME, APP_VERSION, INDEX_FORMAT, INDEX_SCHEMA } from '../version';

// ---------- small helpers ----------
const pct = (arr: number[], p: number): number => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};
export const noiseKey = (t: string): string => t.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const DOT_LEADER = /(\.\s?){5,}|…{2,}/;
/** Document designation: publisher acronym(s), optional TR/TS, number with parts, optional year. */
export const DESIGNATION_RE = /\b((?:[A-Z]{2,6}\/)*[A-Z]{2,6}(?:\/TR|\/TS| TR| TS)?\s+\d{3,6}(?:-\d+)*(?::\d{4})?)/;
const SECTION_RE = /^(Foreword|FOREWORD|Introduction|INTRODUCTION|Bibliography|BIBLIOGRAPHY|Index|INDEX|Index of defined terms|Alphabetical index|Alphabetical index of terms)$/;
const ANNEX_RE = /^Annex\s+([A-Z]{1,2})(?:\s*\((normative|informative)\))?\s*$/;
const CAPTION_RE = /^(Table|Figure)\s+((?:[A-Z]{1,2}\.)?\d+(?:\.\d+)*)\s*[–—-]\s*(.+)$/;
const NUM_HEAD_RE = /^(\d{1,4}(?:\.\d{1,3})*)\s+(?:\*\s*)?([A-Z(][^]*)$/;
const NUM_LONE_RE = /^(\d{1,4}(?:\.\d{1,3})+)$/;
const ANNEX_SUB_RE = /^([A-Z]{1,2})\.(\d{1,3}(?:\.\d{1,3})*)\s+(?:\*\s*)?(\S[^]*)$/;
const LIST_START = /^([a-z]\)|\d{1,2}\)|[–—•-]\s|NOTE\b|EXAMPLE\b|\[Class)/;

/** SSR-013: is `n` a plausible next heading number after `prev`? Tolerates one missed heading. */
export function isSuccessor(prev: number[], n: number[]): boolean {
  if (!prev.length) {
    if (n.length === 1) return n[0] >= 0 && n[0] <= 2;
    return n.length === 2 && ((n[0] === 0 && n[1] >= 1) ||
      (n[0] >= 100 && n[0] <= 999 && n[1] >= 1 && n[1] <= 2));
  }
  if (n.length === 1 && prev[0] >= 100 && n[0] > prev[0] && n[0] <= 299 && n[0] - prev[0] <= 20) return true;
  if (n.length === prev.length + 1 && prev.every((v, i) => v === n[i]) &&
    (n[n.length - 1] === 1 || (prev[0] >= 100 && n[n.length - 1] > 0))) return true;
  for (let i = 0; i < prev.length; i++) {
    if (n.length !== i + 1) continue;
    let ok = true;
    for (let k = 0; k < i; k++) if (n[k] !== prev[k]) { ok = false; break; }
    const iecJump = n[0] >= 100 && n[i] > prev[i] && n[i] <= prev[i] + 100;
    if (ok && (n[i] === prev[i] + 1 || n[i] === prev[i] + 2 || iecJump)) return true;
  }
  return false;
}

const nextLetter = (l: string | null): string[] => {
  if (!l) return ['A'];
  const c = l.charCodeAt(l.length - 1);
  return [String.fromCharCode(c + 1), String.fromCharCode(c + 2)];
};

const isAnnexSuccessor = (prev: string | null, next: string): boolean =>
  !prev || nextLetter(prev).includes(next) || /^([A-Z])\1$/.test(next);

function englishPageEnd(pageLines: Line[][]): number {
  let sawEnglish = false;
  for (let i = 0; i < pageLines.length; i++) {
    const lines = pageLines[i].map((l) => l.text.trim());
    if (lines.some((t) => /^(CONTENTS|TABLE OF CONTENTS|FOREWORD)$/i.test(t))) sawEnglish = true;
    if (sawEnglish && lines.some((t) => /^(SOMMAIRE|AVANT-PROPOS)$/i.test(t))) return i;
  }
  return pageLines.length;
}

/** SSR-016: join PDF lines into readable text (de-hyphenation, list items on new lines). */
export function joinLines(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (!out) { out = t; continue; }
    if (/[a-z]-$/.test(out) && /^[a-z]/.test(t)) out = out.slice(0, -1) + t;
    else if (LIST_START.test(t)) out += '\n' + t;
    else out += ' ' + t;
  }
  return out.replace(/ +([;,.:)])/g, '$1').replace(/’ S\b/g, '’S');
}

interface Heading {
  idx: number; // line index where the heading starts
  kind: ItemKind;
  num: string;
  title: string;
  level: number;
}

interface Ctx {
  contentL: number; contentR: number; bodySize: number; crop: ClauseIndex['crop'];
}

function rectsFor(lines: Line[], from: number, to: number, ctx: Ctx): Rect[] {
  const by = new Map<number, Rect>();
  for (let i = from; i < to; i++) {
    const L = lines[i];
    const r = by.get(L.page);
    if (!r) by.set(L.page, { page: L.page, x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1 });
    else { r.x0 = Math.min(r.x0, L.x0); r.x1 = Math.max(r.x1, L.x1); r.y0 = Math.min(r.y0, L.y0); r.y1 = Math.max(r.y1, L.y1); }
  }
  return [...by.values()].sort((a, b) => a.page - b.page).map((r) => ({
    page: r.page,
    x0: +(Math.min(r.x0, ctx.contentL) - 3).toFixed(1),
    x1: +(Math.max(r.x1, ctx.contentR) + 3).toFixed(1),
    y0: +(r.y0 - 2).toFixed(1),
    y1: +(r.y1 + 2).toFixed(1),
  }));
}

const isParagraphLine = (L: Line, ctx: Ctx): boolean =>
  L.size >= ctx.bodySize - 0.3 && L.maxGap < 2 * L.size && (L.x1 - L.x0) > 0.6 * (ctx.contentR - ctx.contentL) && !/^NOTE/.test(L.text);

// ---------- requirement ("shall") extraction ----------
export interface Sentence { start: number; end: number }

/** SSR-017: find sentence spans containing "shall" in a stream of text. */
export function shallSentences(stream: string): Sentence[] {
  const terms: number[] = [0];
  const re = /\.(?:\s*\[[^\]\n]{1,40}\])?(?=\s+(?:[A-Z(]|NOTE)|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream))) {
    const before = stream.slice(Math.max(0, m.index - 5), m.index);
    if (/\b(e\.g|i\.e|etc|cf|No|Fig|vs)$/.test(before)) continue;
    terms.push(m.index + m[0].length);
  }
  // NOTE / EXAMPLE paragraphs start a new unit
  const nre = /\n(?=NOTE\b|EXAMPLE\b)/g;
  while ((m = nre.exec(stream))) terms.push(m.index + 1);
  terms.push(stream.length);
  const cuts = [...new Set(terms)].sort((a, b) => a - b);
  const out: Sentence[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    let s = cuts[k], e = cuts[k + 1];
    const seg = stream.slice(s, e);
    if (!/\bshall\b/.test(seg)) continue;
    const lead = seg.length - seg.replace(/^\s+/, '').length;
    s += lead;
    if (/^(NOTE|EXAMPLE)\b/.test(stream.slice(s))) continue;
    while (e > s && /\s/.test(stream[e - 1])) e--;
    out.push({ start: s, end: e });
  }
  return out;
}

function requirementsFor(lines: Line[], from: number, to: number, parent: IndexItem, ctx: Ctx, skip: Set<number>): IndexItem[] {
  if (to <= from) return [];
  let stream = '';
  const map: { line: number; off: number }[] = []; // line start offsets in stream
  let inNote = false;
  for (let i = from; i < to; i++) {
    const L = lines[i];
    const t = L.text.trim();
    if (/^(NOTE|EXAMPLE)\b/.test(t)) inNote = true;
    else if (inNote && (/^([a-z]|\d{1,2})\)\s/.test(t) || (L.size >= ctx.bodySize - 0.4 && !/^[–—-]\s/.test(t) && /^[A-Z[]/.test(t)))) inNote = false;
    if (inNote) continue; // informative notes are not part of requirement statements
    if (skip.has(i)) { if (!stream.endsWith('\n.')) stream += '\n.'; continue; } // table/figure content: hard sentence break
    if (stream) stream += '\n';
    map.push({ line: i, off: stream.length });
    stream += L.text;
  }
  const res: IndexItem[] = [];
  let k = 0;
  for (const s of shallSentences(stream)) {
    const rects: Rect[] = [];
    for (let j = 0; j < map.length; j++) {
      const L = lines[map[j].line];
      const ls = map[j].off, le = ls + L.text.length;
      if (le < s.start || ls > s.end) continue;
      const a = Math.max(0, s.start - ls), b = Math.min(L.text.length, s.end - ls);
      if (b <= a) continue;
      rects.push({
        page: L.page,
        x0: +(charX(L, a) - 1.5).toFixed(1), x1: +(charX(L, b) + 1.5).toFixed(1),
        y0: +(L.y0 - 1).toFixed(1), y1: +(L.y1 + 1).toFixed(1),
      });
    }
    if (!rects.length) continue;
    k++;
    const text = joinLines(stream.slice(s.start, s.end).replace(/\n\.$/, '').split('\n').filter((x) => x !== '.'));
    res.push({
      id: `${parent.id}/R${k}`, part: parent.part, kind: 'requirement', num: `${parent.num}/R${k}`,
      title: text.length > 90 ? text.slice(0, 87) + '…' : text, level: parent.level + 1, parent: parent.id,
      page: rects[0].page, pageLabel: '', text, regions: rects,
    });
  }
  return res;
}

// ---------- main entry ----------
export interface AnalyzeOptions { fileName: string; sha256: string; onProgress?: (msg: string) => void }

/** SR-010: build the clause/definition index from raw PDF pages. */
export function analyze(pages: RawPage[], opt: AnalyzeOptions): ClauseIndex {
  const totalPages = pages.length;
  const extractedLines = pages.map(buildLines);
  const englishEnd = englishPageEnd(extractedLines);
  pages = pages.slice(0, englishEnd);
  const n = pages.length;
  const pageLines = extractedLines.slice(0, englishEnd);

  // SSR-012 noise: headers, footers, licence stamps repeated across pages
  const keyPages = new Map<string, Set<number>>();
  pageLines.forEach((ls, pi) => ls.forEach((l) => {
    const k = noiseKey(l.text);
    if (!keyPages.has(k)) keyPages.set(k, new Set());
    keyPages.get(k)!.add(pi);
  }));
  const thr = Math.max(3, Math.ceil(0.2 * n));
  const isNoise = (l: Line, h: number): boolean => {
    if (/^[-`,'´\s]{6,}$/.test(l.text) || /^--`/.test(l.text)) return true;
    const structural = l.text.trim();
    if (NUM_HEAD_RE.test(structural) || NUM_LONE_RE.test(structural) ||
      SECTION_RE.test(structural) || ANNEX_RE.test(structural) || CAPTION_RE.test(structural)) return false;
    const c = keyPages.get(noiseKey(l.text))!.size;
    if (c >= thr) return true;
    const edge = l.y1 < 0.1 * h || l.y0 > 0.9 * h;
    return edge && c >= 3 && n >= 6;
  };

  const pageLabels: string[] = new Array(n).fill('');
  const body: Line[][] = pageLines.map((ls, pi) => {
    const h = pages[pi].height;
    return ls.filter((l) => {
      if (!isNoise(l, h)) return true;
      if (!pageLabels[pi]) {
        const m = l.text.match(/[–-]\s*(\d{1,4})\s*[–-]/) || l.text.match(/^\s*(\d{1,4}|[ivxlc]{1,6})\s*$/);
        if (m) pageLabels[pi] = m[1];
      }
      return false;
    });
  });

  // body font size and content box
  const sizeW = new Map<number, number>();
  body.flat().forEach((l) => { const s = Math.round(l.size * 2) / 2; sizeW.set(s, (sizeW.get(s) || 0) + l.text.length); });
  const bodySize = [...sizeW.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
  const dense = body.filter((ls) => ls.length >= 6);
  const all = (dense.length ? dense : body).flat();
  const x0s = all.map((l) => Math.round(l.x0));
  const xMode = new Map<number, number>(); x0s.forEach((x) => xMode.set(x, (xMode.get(x) || 0) + 1));
  const contentL = [...xMode.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 50;
  const contentR = pct(all.filter((l) => l.size >= bodySize - 0.3).map((l) => l.x1), 0.97) || pages[0].width - 50;
  const W = pages[0]?.width ?? 595, H = pages[0]?.height ?? 842;
  const pad = 14;
  const padY = 6;
  const crop = dense.length
    ? {
      x0: Math.max(0, Math.min(contentL, pct(dense.map((ls) => Math.min(...ls.map((l) => l.x0))), 0.05)) - pad),
      x1: Math.min(W, Math.max(contentR, pct(dense.map((ls) => Math.max(...ls.map((l) => l.x1))), 0.95)) + pad),
      y0: Math.max(0, pct(dense.map((ls) => Math.min(...ls.map((l) => l.y0))), 0.05) - padY),
      y1: Math.min(H, pct(dense.map((ls) => Math.max(...ls.map((l) => l.y1))), 0.95) + padY),
    }
    : { x0: 0, y0: 0, x1: W, y1: H };
  (Object.keys(crop) as (keyof typeof crop)[]).forEach((k) => { crop[k] = +crop[k].toFixed(1); });
  const ctx: Ctx = { contentL, contentR, bodySize, crop };

  // designation guess
  const desig = new Map<string, number>();
  pageLines.forEach((ls, pi) => ls.forEach((l) => {
    const m = l.text.match(DESIGNATION_RE);
    if (!m) return;
    const edge = l.y1 < 0.1 * pages[pi].height || l.y0 > 0.9 * pages[pi].height;
    const weight = 1 + (pi < 5 ? 20 : 0) + (edge ? 10 : 0);
    desig.set(m[1], (desig.get(m[1]) || 0) + weight);
  }));
  const desigYears = new Map<string, number>();
  for (const [candidate, score] of desig) {
    const base = candidate.replace(/:\d{4}$/, '');
    desigYears.set(base, (desigYears.get(base) || 0) + score);
  }
  if (desigYears.size > 1) {
    const ownBase = [...desigYears.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const candidate of desig.keys()) if (candidate.replace(/:\d{4}$/, '') !== ownBase) desig.delete(candidate);
  }
  let designation = [...desig.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? opt.fileName.replace(/\.pdf$/i, '');
  const amd = new Map<string, number>();
  pageLines.flat().forEach((l) => { for (const m of l.text.matchAll(/\+\s?(AMD|A)(\d+):(\d{4})/g)) { const k = `+${m[1]}${m[2]}:${m[3]}`; amd.set(k, (amd.get(k) || 0) + 1); } });
  const amdTop = [...amd.entries()].filter(([, c]) => c >= Math.max(3, 0.2 * n)).map(([k]) => k).sort();
  if (amdTop.length && /:\d{4}$/.test(designation)) designation += amdTop.join('');

  // SSR-014 parts (e.g. redline + final in consolidated editions)
  const markers: { page: number; label: string }[] = [];
  body.forEach((ls, pi) => {
    if (ls.length > 30) return;
    const hit = ls.find((l) => /^(REDLINE|FINAL)\s+VERSION$/.test(l.text.trim()));
    if (hit) markers.push({ page: pi + 1, label: hit.text.trim().replace(/\s+VERSION$/, '').toLowerCase().replace(/^./, (c) => c.toUpperCase()) });
  });
  const parts: Part[] = [];
  if (!markers.length) parts.push({ id: 'doc', label: 'Document', pageStart: 1, pageEnd: n });
  else {
    if (markers[0].page > 1) parts.push({ id: 'front', label: 'Front matter', pageStart: 1, pageEnd: markers[0].page - 1 });
    markers.forEach((m, i) => parts.push({
      id: m.label.toLowerCase(), label: m.label, pageStart: m.page, pageEnd: i + 1 < markers.length ? markers[i + 1].page - 1 : n,
    }));
  }
  const defaultPart = (parts.find((p) => p.id === 'final') ?? [...parts].sort((a, b) => (b.pageEnd - b.pageStart) - (a.pageEnd - a.pageStart))[0]).id;

  const items: IndexItem[] = [];
  const usedIds = new Set<string>();
  const uid = (base: string): string => { let id = base, k = 2; while (usedIds.has(id)) id = `${base}~${k++}`; usedIds.add(id); return id; };

  for (const part of parts) {
    opt.onProgress?.(`Indexing ${part.label}…`);
    const lines: Line[] = [];
    for (let p = part.pageStart; p <= part.pageEnd; p++) {
      const ls = body[p - 1];
      if (ls.filter((l) => DOT_LEADER.test(l.text)).length >= 5) continue; // table of contents page
      lines.push(...ls.filter((l) => !DOT_LEADER.test(l.text)));
    }
    const heads: Heading[] = [];
    const captions: { idx: number; kind: 'table' | 'figure'; num: string; title: string }[] = [];
    let prev: number[] = [];
    let annex: string | null = null;
    let annexPath: number[] = [];
    let stopNumeric = false;
    const seenSections = new Set<string>();
    const stack: Heading[] = [];
    const push = (h: Heading): void => {
      while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
      heads.push(h); stack.push(h);
    };

    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      const t = L.text.trim();
      const leftOK = L.x0 <= contentL + 4;
      const big = L.maxSize >= bodySize - 0.3;
      if (SECTION_RE.test(t) && big && !seenSections.has(t.toLowerCase())) {
        seenSections.add(t.toLowerCase());
        if (/^(bibliography|index|alphabetical)/i.test(t)) { stopNumeric = true; annex = null; }
        push({ idx: i, kind: 'section', num: '', title: t.charAt(0) + t.slice(1).toLowerCase(), level: 1 });
        continue;
      }
      let m = t.match(ANNEX_RE);
      if (m && !stopNumeric && isAnnexSuccessor(annex, m[1]) && big) {
        let type = m[2] ?? '';
        const titleParts: string[] = [];
        for (let j = i + 1; j < Math.min(lines.length, i + 6) && lines[j].page === L.page; j++) {
          const tj = lines[j].text.trim();
          const mm = tj.match(/^\((normative|informative)\)$/);
          if (mm) { type = mm[1]; continue; }
          if (lines[j].size < L.size - 0.6) break;
          titleParts.push(tj);
        }
        annex = m[1]; annexPath = [];
        push({ idx: i, kind: 'annex', num: m[1], title: titleParts.join(' ') + (type ? ` (${type})` : ''), level: 1 });
        continue;
      }
      if (annex && leftOK && big && t.length < 160) {
        m = t.match(ANNEX_SUB_RE);
        if (m && m[1] === annex) {
          const path = m[2].split('.').map(Number);
          const addedPath = path.length === annexPath.length + 1 && annexPath.every((v, j) => path[j] === v) &&
            path[path.length - 1] >= 100;
          if (isSuccessor(annexPath, path) || addedPath) {
            annexPath = path;
            push({ idx: i, kind: 'annex', num: `${m[1]}.${m[2]}`, title: m[3].trim(), level: 1 + path.length });
            continue;
          }
        }
      }
      if (!stopNumeric && leftOK && big) {
        m = t.match(NUM_HEAD_RE);
        let path: number[] | null = null, title = '';
        if (m && t.length < 160) { path = m[1].split('.').map(Number); title = m[2].trim(); }
        else if ((m = t.match(NUM_LONE_RE)) && i + 1 < lines.length) { path = m[1].split('.').map(Number); title = lines[i + 1].text.trim(); }
        if (path && isSuccessor(prev, path)) {
          prev = path;
          annex = null;
          annexPath = [];
          const num = path.join('.');
          const lone = NUM_LONE_RE.test(t);
        const definitionLevel = [...stack].reverse().find((h) => /terms?\s+and\s+definitions|^definitions/i.test(h.title))?.level ?? -1;
          const isDefinitionContainer = /^(?:terms?\s+and\s+definitions|definitions)$/i.test(title);
          const kind: ItemKind = !isDefinitionContainer && definitionLevel >= 0 && path.length > definitionLevel &&
          (lone || path.length > 1) ? 'definition' : 'clause';
          push({ idx: i, kind, num, title, level: path.length });
          continue;
        }
      }
      m = t.match(CAPTION_RE);
      if (m && !/\(continued\)/i.test(t) && !captions.some((c) => c.kind === m![1].toLowerCase() && c.num === m![2])) {
        captions.push({ idx: i, kind: m[1].toLowerCase() as 'table' | 'figure', num: m[2], title: m[3].trim() });
      }
    }

    // table / figure extents (line ranges), computed first so requirement detection can skip them
    const headIdx = new Set(heads.map((h) => h.idx));
    const capIdx = new Set(captions.map((x) => x.idx));
    const capRanges = captions.map((c) => {
      let from = c.idx, to = c.idx + 1;
      if (c.kind === 'table') {
        let j = c.idx + 1;
        for (; j < lines.length && j < c.idx + 400; j++) {
          if (headIdx.has(j) || capIdx.has(j)) break;
          if (isParagraphLine(lines[j], ctx) && j + 1 < lines.length && isParagraphLine(lines[j + 1], ctx)) break;
        }
        to = j;
      } else {
        let j = c.idx - 1;
        while (j >= 0 && lines[j].page === lines[c.idx].page && !headIdx.has(j) && !isParagraphLine(lines[j], ctx)) j--;
        from = j + 1;
      }
      return { from, to };
    });
    const skip = new Set<number>();
    capRanges.forEach((r) => { for (let i = r.from; i < r.to; i++) skip.add(i); });

    // regions and text for headings
    const partItems: IndexItem[] = [];
    const idStack: IndexItem[] = [];
    heads.forEach((h, k) => {
      const ownEnd = k + 1 < heads.length ? heads[k + 1].idx : lines.length;
      let fullEnd = lines.length;
      for (let q = k + 1; q < heads.length; q++) if (heads[q].level <= h.level) { fullEnd = heads[q].idx; break; }
      while (idStack.length && idStack[idStack.length - 1].level >= h.level) idStack.pop();
      const label = h.kind === 'section' ? h.title.toLowerCase().replace(/\s+/g, '-') : h.num;
      const regions = rectsFor(lines, h.idx, ownEnd, ctx);
      const it: IndexItem = {
        id: uid(`${part.id}:${label}`), part: part.id, kind: h.kind, num: h.num, title: h.title, level: h.level,
        parent: idStack.length ? idStack[idStack.length - 1].id : null,
        page: lines[h.idx].page, pageLabel: pageLabels[lines[h.idx].page - 1] || '',
        text: joinLines(lines.slice(h.idx, ownEnd).map((l) => l.text)),
        regions,
      };
      if (fullEnd > ownEnd) it.full = rectsFor(lines, h.idx, fullEnd, ctx);
      idStack.push(it);
      partItems.push(it);
      if (h.kind !== 'definition') {
        const reqs = requirementsFor(lines, h.idx + 1, ownEnd, it, ctx, skip);
        reqs.forEach((r) => { r.id = uid(r.id); r.pageLabel = pageLabels[r.page - 1] || ''; });
        partItems.push(...reqs);
      }
    });

    // tables and figures
    captions.forEach((c, ci) => {
      const enclosing = [...heads].reverse().find((h) => h.idx <= c.idx);
      const parentItem = enclosing ? partItems.find((p) => p.kind !== 'requirement' && lines[enclosing.idx].page === p.page && p.num === enclosing.num && p.title === enclosing.title) : undefined;
      const { from, to } = capRanges[ci];
      let regions = rectsFor(lines, from, to, ctx);
      if (c.kind === 'figure') {
        const capL = lines[c.idx];
        const above = from - 1 >= 0 && lines[from - 1].page === capL.page ? lines[from - 1].y1 + 3 : crop.y0 + 2;
        regions = [{ page: capL.page, x0: +(contentL - 3).toFixed(1), x1: +(contentR + 3).toFixed(1), y0: +above.toFixed(1), y1: +(capL.y1 + 2).toFixed(1) }];
      }
      const num = `${c.kind === 'table' ? 'Table' : 'Figure'} ${c.num}`;
      partItems.push({
        id: uid(`${part.id}:${num.replace(' ', '-')}`), part: part.id, kind: c.kind, num, title: c.title,
        level: 9, parent: parentItem?.id ?? null, page: lines[c.idx].page, pageLabel: pageLabels[lines[c.idx].page - 1] || '',
        text: joinLines(lines.slice(c.idx, Math.min(to, c.idx + 1)).map((l) => l.text)), regions,
      });
    });
    items.push(...partItems);
  }

  return {
    format: INDEX_FORMAT, version: INDEX_SCHEMA,
    generator: { app: APP_NAME, version: APP_VERSION, analyzer: ANALYZER_VERSION },
    source: { fileName: opt.fileName, sha256: opt.sha256, pages: totalPages, designation, title: '' },
    createdAt: new Date().toISOString(),
    crop, pageSizes: pages.map((p) => [+p.width.toFixed(2), +p.height.toFixed(2)]), pageLabels,
    parts, defaultPart, items,
  };
}
