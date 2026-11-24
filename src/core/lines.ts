import type { Line, RawPage, Seg } from './types';

/** SSR-011: group text runs into visual lines, joining small-caps splits without spaces. */
export function buildLines(p: RawPage): Line[] {
  const items = p.items.filter((i) => i.str.length > 0 && i.size > 0.5);
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: (typeof items)[] = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g) {
      const ref = g[0];
      const tol = Math.max(1.5, 0.45 * Math.min(ref.size, it.size));
      if (Math.abs(it.y - ref.y) <= tol) { g.push(it); continue; }
    }
    groups.push([it]);
  }
  const lines: Line[] = [];
  for (const g of groups) {
    g.sort((a, b) => a.x - b.x);
    let text = '';
    const segs: Seg[] = [];
    let lastX1 = -1e9;
    let maxGap = 0;
    let sizeAcc = 0, sizeN = 0;
    let font = '';
    let prevIt: (typeof g)[number] | null = null;
    for (const it of g) {
      const s = it.str;
      if (!s.trim()) {
        // explicit whitespace run
        if (text && !text.endsWith(' ')) text += ' ';
        lastX1 = Math.max(lastX1, it.x + it.w);
        continue;
      }
      if (text) {
        const gap = it.x - lastX1;
        if (lastX1 > -1e8) maxGap = Math.max(maxGap, gap);
        const thr = 0.18 * it.size;
        if (gap > thr && !text.endsWith(' ') && !s.startsWith(' ')) text += ' ';
      }
      // small caps: "R ISK" -> "RISK" (large initial, smaller capitals, PDF-inserted space)
      if (prevIt && text.endsWith(' ') && /(^|[^A-Za-z])[A-Za-z]$/.test(prevIt.str.trim()) && it.size < prevIt.size * 0.92 && /^[A-Z]{2}/.test(s) && it.x - (prevIt.x + prevIt.w) < 0.15 * it.size) {
        text = text.slice(0, -2) + text.slice(-2, -1).toUpperCase();
      }
      prevIt = it;
      const t0 = text.length;
      text += s;
      segs.push({ t0, t1: text.length, x0: it.x, x1: it.x + it.w });
      lastX1 = Math.max(lastX1, it.x + it.w);
      sizeAcc += it.size * s.length; sizeN += s.length;
      if (!font) font = it.font;
    }
    const trimmed = text.replace(/\s+$/, '');
    const lead = trimmed.length - trimmed.replace(/^\s+/, '').length;
    if (!trimmed.trim()) continue;
    const size = sizeN ? sizeAcc / sizeN : g[0].size;
    const real = g.filter((i) => i.str.trim());
    const x0 = Math.min(...real.map((i) => i.x));
    const x1 = Math.max(...real.map((i) => i.x + i.w));
    const maxSize = Math.max(...real.map((i) => i.size));
    const base = Math.max(...real.map((i) => i.y));
    const top = Math.min(...real.map((i) => i.y - i.size * 0.88));
    lines.push({
      page: p.page,
      text: trimmed.slice(lead),
      x0, x1, y0: top, y1: base + maxSize * 0.24,
      size, maxSize, font,
      segs: segs.map((s) => ({ ...s, t0: Math.max(0, s.t0 - lead), t1: Math.max(0, s.t1 - lead) })),
      maxGap,
    });
  }
  return lines;
}

/** Map a character offset in a line to an x coordinate (linear inside a segment). */
export function charX(line: Line, off: number): number {
  for (const s of line.segs) {
    if (off >= s.t0 && off <= s.t1) {
      const n = Math.max(1, s.t1 - s.t0);
      return s.x0 + ((off - s.t0) / n) * (s.x1 - s.x0);
    }
    if (off < s.t0) return s.x0;
  }
  return line.x1;
}
