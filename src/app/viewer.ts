// SR-020..SR-024: continuous, margin-cropped PDF view with red region overlays.
import type { ClauseIndex, Rect } from '../core/types';
import type { ScrollMotion } from './store';

/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfDoc = any;

export interface Crop { x0: number; y0: number; x1: number; y1: number }

/** SSR-021: crop box for a page (shared crop, falling back to the full page for odd-sized pages). */
export function pageCrop(idx: ClauseIndex, page: number): Crop {
  const [w, h] = idx.pageSizes[page - 1];
  const [w0, h0] = idx.pageSizes[0];
  const c = idx.crop;
  if (Math.abs(w - w0) > 2 || Math.abs(h - h0) > 2) return { x0: 0, y0: 0, x1: w, y1: h };
  return { x0: Math.max(0, c.x0), y0: Math.max(0, c.y0), x1: Math.min(w, c.x1), y1: Math.min(h, c.y1) };
}

/** SSR-022: rectangle -> CSS box relative to the cropped page, with continuation flags. */
export function rectToCss(r: Rect, crop: Crop, scale: number): { left: number; top: number; width: number; height: number } {
  const x0 = Math.max(r.x0, crop.x0), x1 = Math.min(r.x1, crop.x1);
  const y0 = Math.max(r.y0, crop.y0), y1 = Math.min(r.y1, crop.y1);
  return { left: (x0 - crop.x0) * scale, top: (y0 - crop.y0) * scale, width: Math.max(2, (x1 - x0) * scale), height: Math.max(2, (y1 - y0) * scale) };
}

interface PageView { page: number; el: HTMLDivElement; canvas: HTMLCanvasElement | null; overlay: HTMLDivElement; rendered: number; task: any }

export interface ScrollStep { top: number; behavior: ScrollBehavior; delay: number }

export function scrollPlan(current: number, target: number, motion: ScrollMotion): ScrollStep[] {
  if (motion === 'full') return [{ top: target, behavior: 'smooth', delay: 0 }];
  if (motion === 'none') return [{ top: target, behavior: 'auto', delay: 0 }];
  const distance = target - current;
  if (Math.abs(distance) <= 96) return [{ top: target, behavior: 'auto', delay: 0 }];
  const cue = Math.min(72, Math.abs(distance) / 4);
  return [
    { top: current + Math.sign(distance) * cue, behavior: 'smooth', delay: 0 },
    { top: target, behavior: 'auto', delay: 120 },
  ];
}

export class Viewer {
  scale = 1;
  pages: PageView[] = [];
  private io: IntersectionObserver | null = null;
  private visible = new Set<number>();
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  onPageClick: (page: number, x: number, y: number) => void = () => {};
  onVisiblePage: (page: number) => void = () => {};

  constructor(private root: HTMLElement, private doc: PdfDoc, private idx: ClauseIndex) {}

  fitWidth(): void {
    const c = pageCrop(this.idx, this.pages[0]?.page ?? 1);
    const avail = this.root.clientWidth - 24;
    this.scale = Math.max(0.4, Math.min(3, avail / (c.x1 - c.x0)));
  }

  show(pageStart: number, pageEnd: number): void {
    this.io?.disconnect();
    this.root.innerHTML = '';
    this.pages = [];
    this.visible.clear();
    for (let p = pageStart; p <= pageEnd; p++) {
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.page = String(p);
      const tag = document.createElement('div');
      tag.className = 'ptag';
      const lbl = this.idx.pageLabels[p - 1];
      tag.textContent = `PDF p.${p}${lbl ? ` · printed ${lbl}` : ''}`;
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      el.append(tag, overlay);
      el.addEventListener('click', (ev) => {
        const rect = el.getBoundingClientRect();
        const c = pageCrop(this.idx, p);
        this.onPageClick(p, c.x0 + (ev.clientX - rect.left) / this.scale, c.y0 + (ev.clientY - rect.top) / this.scale);
      });
      this.root.append(el);
      this.pages.push({ page: p, el, canvas: null, overlay, rendered: 0, task: null });
    }
    if (!this.scale || this.scale === 1) this.fitWidth();
    this.layout();
    this.io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        const p = Number((e.target as HTMLElement).dataset.page);
        if (e.isIntersecting) this.visible.add(p); else this.visible.delete(p);
      }
      this.pump();
    }, { root: this.root, rootMargin: '600px 0px' });
    this.pages.forEach((pv) => this.io!.observe(pv.el));
    this.root.onscroll = () => {
      const mid = this.root.scrollTop + this.root.clientHeight / 3;
      const pv = this.pages.find((v) => v.el.offsetTop + v.el.offsetHeight > mid);
      if (pv) this.onVisiblePage(pv.page);
    };
  }

  layout(): void {
    for (const pv of this.pages) {
      const c = pageCrop(this.idx, pv.page);
      pv.el.style.width = `${(c.x1 - c.x0) * this.scale}px`;
      pv.el.style.height = `${(c.y1 - c.y0) * this.scale}px`;
      if (pv.rendered && pv.rendered !== this.scale) pv.rendered = -1; // stale
    }
    this.pump();
  }

  setScale(s: number): void {
    const anchor = this.root.scrollTop / Math.max(1, this.root.scrollHeight);
    this.scale = Math.max(0.3, Math.min(4, s));
    this.layout();
    this.root.scrollTop = anchor * this.root.scrollHeight;
    this.redrawOverlays();
  }

  private pump(): void {
    const keep = new Set<number>();
    for (const p of this.visible) for (let d = -1; d <= 1; d++) keep.add(p + d);
    for (const pv of this.pages) {
      if (keep.has(pv.page)) { if (pv.rendered !== this.scale) void this.render(pv); }
      else if (pv.canvas && !this.nearVisible(pv.page, 4)) { pv.canvas.remove(); pv.canvas = null; pv.rendered = 0; }
    }
  }

  private nearVisible(p: number, d: number): boolean { for (const v of this.visible) if (Math.abs(v - p) <= d) return true; return false; }

  private async render(pv: PageView): Promise<void> {
    if (pv.task) { try { pv.task.cancel(); } catch { /* */ } }
    const scale = this.scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const page = await this.doc.getPage(pv.page);
    const c = pageCrop(this.idx, pv.page);
    const vp = page.getViewport({ scale: scale * dpr });
    const cv = document.createElement('canvas');
    cv.width = Math.ceil((c.x1 - c.x0) * scale * dpr);
    cv.height = Math.ceil((c.y1 - c.y0) * scale * dpr);
    cv.style.width = `${(c.x1 - c.x0) * scale}px`;
    cv.style.height = `${(c.y1 - c.y0) * scale}px`;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    const task = page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -c.x0 * scale * dpr, -c.y0 * scale * dpr] });
    pv.task = task;
    try { await task.promise; } catch { return; }
    if (scale !== this.scale) return;
    pv.canvas?.remove();
    pv.el.insertBefore(cv, pv.el.firstChild);
    pv.canvas = cv; pv.rendered = scale; pv.task = null;
  }

  // ----- overlays -----
  private hl: { rects: Rect[]; cls: string; id?: string }[] = [];

  setHighlights(groups: { rects: Rect[]; cls: string; id?: string }[]): void { this.hl = groups; this.redrawOverlays(); }

  redrawOverlays(): void {
    for (const pv of this.pages) pv.overlay.innerHTML = '';
    const byPage = new Map(this.pages.map((p) => [p.page, p]));
    for (const g of this.hl) {
      const pagesOf = g.rects.map((r) => r.page);
      g.rects.forEach((r) => {
        const pv = byPage.get(r.page);
        if (!pv) return;
        const c = pageCrop(this.idx, r.page);
        const css = rectToCss(r, c, this.scale);
        const d = document.createElement('div');
        d.className = `hl ${g.cls}`;
        if (g.cls === 'main') {
          if (pagesOf.includes(r.page + 1)) d.classList.add('cont-down');
          if (pagesOf.includes(r.page - 1)) d.classList.add('cont-up');
        }
        if (g.id) d.dataset.id = g.id;
        Object.assign(d.style, { left: `${css.left}px`, top: `${css.top}px`, width: `${css.width}px`, height: `${css.height}px` });
        pv.overlay.append(d);
      });
    }
  }

  scrollToRect(r: Rect, motion: ScrollMotion = 'full'): void {
    const pv = this.pages.find((p) => p.page === r.page);
    if (!pv) return;
    const c = pageCrop(this.idx, r.page);
    const top = pv.el.offsetTop + Math.max(0, (r.y0 - c.y0) * this.scale) - 40;
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    const steps = scrollPlan(this.root.scrollTop, top, motion);
    this.root.scrollTo(steps[0]);
    if (steps[1]) {
      this.scrollTimer = setTimeout(() => {
        this.root.scrollTo(steps[1]);
        this.scrollTimer = null;
      }, steps[1].delay);
    }
  }

  scrollToPage(p: number): void {
    const pv = this.pages.find((v) => v.page === p);
    if (pv) this.root.scrollTo({ top: pv.el.offsetTop - 8 });
  }
}

/** SR-031: render the given regions to a single stacked PNG (data URL). */
export async function regionsToImage(doc: PdfDoc, rects: Rect[], scale = 2, margin = 4): Promise<string> {
  const parts: HTMLCanvasElement[] = [];
  for (const r of rects) {
    const page = await doc.getPage(r.page);
    const vp = page.getViewport({ scale });
    const x0 = Math.max(0, r.x0 - margin), y0 = Math.max(0, r.y0 - margin);
    const w = Math.ceil((r.x1 - r.x0 + 2 * margin) * scale), h = Math.ceil((r.y1 - r.y0 + 2 * margin) * scale);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x0 * scale, -y0 * scale] }).promise;
    parts.push(cv);
  }
  const gap = 10;
  const W = Math.max(...parts.map((p) => p.width));
  const H = parts.reduce((a, p) => a + p.height, 0) + gap * (parts.length - 1);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  let y = 0;
  parts.forEach((p, i) => {
    ctx.drawImage(p, 0, y);
    y += p.height;
    if (i < parts.length - 1) {
      ctx.strokeStyle = '#bbb'; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(0, y + gap / 2); ctx.lineTo(W, y + gap / 2); ctx.stroke();
      y += gap;
    }
  });
  return out.toDataURL('image/png');
}
