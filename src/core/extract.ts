import type { RawItem, RawPage } from './types';

// Minimal structural types so this module does not depend on pdf.js at compile time.
export interface PjsTextItem { str?: string; transform?: number[]; width?: number; fontName?: string }
export interface PjsViewport { width: number; height: number; transform: number[] }
export interface PjsPage {
  getViewport(o: { scale: number }): PjsViewport;
  getTextContent(): Promise<{ items: PjsTextItem[] }>;
}

const mul = (m1: number[], m2: number[]): number[] => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

/** SSR-010: convert pdf.js text content into top-left oriented runs (horizontal text only). */
export async function extractPage(page: PjsPage, pageNo: number): Promise<RawPage> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: RawItem[] = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.transform) continue;
    const t = mul(vp.transform, it.transform);
    const size = Math.hypot(t[0], t[1]);
    if (size < 0.5 || Math.abs(t[1]) > 0.02 * size) continue; // skip rotated runs (side stamps)
    items.push({ str: it.str, x: t[4], y: t[5], w: it.width ?? 0, size, font: it.fontName ?? '' });
  }
  return { page: pageNo, width: vp.width, height: vp.height, items };
}
