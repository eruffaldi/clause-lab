// SR-040: persistence (IndexedDB for indices, localStorage for the basket). All calls are best effort.
import type { ClauseIndex } from '../core/types';

const DB = 'clause-lab';
const STORE = 'indices';
const SCROLL_MOTION_KEY = 'icl.scroll-motion';

export type ScrollMotion = 'full' | 'none' | 'peek';

export function normalizeScrollMotion(value: unknown): ScrollMotion {
  return value === 'none' || value === 'peek' ? value : 'full';
}

export function loadScrollMotion(): ScrollMotion {
  try { return normalizeScrollMotion(localStorage.getItem(SCROLL_MOTION_KEY)); }
  catch { return 'full'; }
}

export function saveScrollMotion(motion: ScrollMotion): void {
  try { localStorage.setItem(SCROLL_MOTION_KEY, motion); }
  catch { /* storage unavailable */ }
}

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function loadIndex(sha: string): Promise<ClauseIndex | null> {
  try {
    const db = await open();
    return await new Promise((res) => {
      const q = db.transaction(STORE, 'readonly').objectStore(STORE).get(sha);
      q.onsuccess = () => res((q.result as ClauseIndex) ?? null);
      q.onerror = () => res(null);
    });
  } catch { return null; }
}

export async function saveIndex(idx: ClauseIndex): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(idx, idx.source.sha256);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch { /* storage unavailable */ }
}

export interface BasketEntry { id: string; full: boolean; note: string; status: string }

export function loadBasket(sha: string): BasketEntry[] {
  try { return JSON.parse(localStorage.getItem(`icl.basket.${sha}`) || '[]') as BasketEntry[]; } catch { return []; }
}
export function saveBasket(sha: string, b: BasketEntry[]): void {
  try { localStorage.setItem(`icl.basket.${sha}`, JSON.stringify(b)); } catch { /* ignore */ }
}

/** SSR-041: SHA-256 of the PDF bytes (falls back to FNV-1a when SubtleCrypto is unavailable). */
export async function hashBytes(buf: ArrayBuffer): Promise<string> {
  try {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    const a = new Uint8Array(buf);
    let h = 0x811c9dc5;
    for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return `fnv-${h.toString(16)}-${a.length}`;
  }
}
