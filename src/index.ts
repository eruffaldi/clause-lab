// Clause Lab — application entry point (UR-001..UR-006).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { analyze } from './core/analyze';
import { extractPage, type PjsPage } from './core/extract';
import { buildReport, citation, esc, hitTest, KIND_LABEL, searchItems, type ReportEntry } from './core/query';
import type { ClauseIndex, IndexItem, ItemKind } from './core/types';
import { isCurrentAnalysis, normalizeIndex } from './core/schema';
import { hashBytes, loadBasket, loadIndex, loadScrollMotion, saveBasket, saveIndex, saveScrollMotion, type BasketEntry, type ScrollMotion } from './app/store';
import { regionsToImage, Viewer } from './app/viewer';

/* eslint-disable @typescript-eslint/no-explicit-any */
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---------- deferred worker hydration (skill: payload in non-executable tag) ----------
function setupWorker(): void {
  const el = document.getElementById('pdfjs-worker');
  if (!el) return;
  const b64 = (el.textContent || '').trim();
  if (!b64) return;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  (pdfjs as any).GlobalWorkerOptions.workerSrc = url;
  el.textContent = '';
}

// ---------- state ----------
const S: {
  doc: any; idx: ClauseIndex | null; fileName: string; sha: string; part: string;
  kinds: Set<ItemKind>; sel: IndexItem | null; selReq: IndexItem | null; full: boolean;
  basket: BasketEntry[]; viewer: Viewer | null; pendingIdx: ClauseIndex | null; byId: Map<string, IndexItem>;
  scrollMotion: ScrollMotion;
} = {
  doc: null, idx: null, fileName: '', sha: '', part: '', kinds: new Set(['section', 'clause', 'definition', 'annex', 'table', 'figure']),
  sel: null, selReq: null, full: false, basket: [], viewer: null, pendingIdx: null, byId: new Map(),
  scrollMotion: loadScrollMotion(),
};

function toast(msg: string): void {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout((t as any)._h); (t as any)._h = setTimeout(() => t.classList.remove('on'), 2600);
}
function progress(msg: string | null, frac = 0): void {
  $('prog').classList.toggle('on', msg !== null);
  if (msg !== null) { $('progMsg').textContent = msg; ($('progBar') as HTMLElement).style.width = `${Math.round(frac * 100)}%`; }
}
// Hosted (claude.ai artifact) pages cannot start downloads themselves: use the platform `downloads` capability.
const hosted = (): boolean => typeof (window as any).claude?.use === 'function';
let dlNs: Promise<any> | null = null;
function download(name: string, data: string | Blob, type = 'application/octet-stream'): void {
  if (hosted()) {
    dlNs ??= (window as any).claude.use('downloads');
    void dlNs!.then(async (ns: any) => {
      if (!ns) { toast('Downloads are not available in this view — open the HTML file locally'); return; }
      try { await ns.save({ filename: name, data }); }
      catch (e: any) { if (e?.code !== 'declined') toast(`Download failed: ${e?.message ?? e?.code ?? e}`); }
    });
    return;
  }
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function copy(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch { toast('Copy failed'); }
    ta.remove();
  }
}

// ---------- PDF + index lifecycle ----------
async function openPdf(file: File): Promise<void> {
  setupWorker();
  progress('Reading PDF…', 0.02);
  try {
    const buf = await file.arrayBuffer();
    const sha = await hashBytes(buf);
    const doc = await (pdfjs as any).getDocument({ data: new Uint8Array(buf.slice(0)), verbosity: 0, isEvalSupported: false }).promise;
    S.doc = doc; S.fileName = file.name; S.sha = sha;
    let idx: ClauseIndex | null = null;
    if (S.pendingIdx) {
      if (S.pendingIdx.source.sha256 !== sha) toast('Loaded index was made for a different file — using it anyway');
      idx = S.pendingIdx; S.pendingIdx = null;
    }
    if (!idx) {
      const cached = await loadIndex(sha);
      idx = cached && cached.source.pages === doc.numPages && isCurrentAnalysis(cached) ? cached : null;
      if (cached && !idx) toast('Cached index is from another analyzer revision — re-indexing');
    }
    if (!idx) idx = await runAnalysis();
    else toast('Index loaded from local cache');
    setIndex(idx);
  } catch (e) {
    console.error(e);
    toast(`Could not open PDF: ${(e as Error).message}`);
  } finally { progress(null); }
}

async function runAnalysis(): Promise<ClauseIndex> {
  const n = S.doc.numPages;
  const pages = [];
  for (let i = 1; i <= n; i++) {
    progress(`Import mode · extracting text ${i}/${n}`, (i / n) * 0.9);
    pages.push(await extractPage((await S.doc.getPage(i)) as PjsPage, i));
  }
  progress('Detecting clauses, definitions, requirements…', 0.95);
  await new Promise((r) => setTimeout(r, 20));
  const idx = analyze(pages, { fileName: S.fileName, sha256: S.sha });
  await saveIndex(idx);
  toast(`Indexed ${idx.items.length} items`);
  return idx;
}

function setIndex(idx: ClauseIndex): void {
  S.idx = idx;
  S.byId = new Map(idx.items.map((i) => [i.id, i]));
  S.basket = loadBasket(idx.source.sha256).filter((b) => S.byId.has(b.id));
  ($('des') as HTMLInputElement).value = idx.source.designation;
  const sel = $('part') as HTMLSelectElement;
  sel.innerHTML = idx.parts.map((p) => `<option value="${p.id}">${esc(p.label)} (pp. ${p.pageStart}–${p.pageEnd})</option>`).join('');
  ['des', 'part', 'saveIdx', 'reIdx'].forEach((id) => (($(id) as HTMLInputElement).disabled = false));
  ($('rTitle') as HTMLInputElement).value ||= `${idx.source.designation} — extract`;
  $('empty')?.remove();
  S.viewer = new Viewer($('view'), S.doc, idx);
  S.viewer.onPageClick = onPageClick;
  setPart(idx.parts.some((p) => p.id === S.part) ? S.part : idx.defaultPart);
  renderBasket();
}

function setPart(id: string): void {
  if (!S.idx || !S.viewer) return;
  S.part = id;
  ($('part') as HTMLSelectElement).value = id;
  const p = S.idx.parts.find((x) => x.id === id)!;
  S.viewer.scale = 1;
  S.viewer.show(p.pageStart, p.pageEnd);
  S.sel = null; S.selReq = null;
  renderList(); renderDetail(); S.viewer.setHighlights([]);
}

// ---------- index list ----------
function renderChips(): void {
  const kinds: ItemKind[] = ['clause', 'definition', 'annex', 'table', 'figure', 'section', 'requirement'];
  $('chips').innerHTML = kinds.map((k) => `<button class="chip ${S.kinds.has(k) ? 'on' : ''}" data-k="${k}">${k === 'requirement' ? '“shall”' : KIND_LABEL[k] + 's'}</button>`).join('');
}

function renderList(): void {
  if (!S.idx) return;
  const q = ($('q') as HTMLInputElement).value;
  const items = searchItems(S.idx.items, S.part, S.kinds, q);
  const reqCount = new Map<string, number>();
  S.idx.items.forEach((i) => { if (i.kind === 'requirement' && i.parent) reqCount.set(i.parent, (reqCount.get(i.parent) || 0) + 1); });
  const inB = new Set(S.basket.map((b) => b.id));
  const all = S.idx.items.filter((i) => i.part === S.part);
  const counts: Partial<Record<ItemKind, number>> = {};
  all.forEach((i) => { counts[i.kind] = (counts[i.kind] || 0) + 1; });
  $('stat').textContent = `${items.length} shown · ${counts.clause || 0} clauses · ${counts.definition || 0} definitions · ${counts.annex || 0} annex · ${(counts.table || 0) + (counts.figure || 0)} tables/figures · ${counts.requirement || 0} shall`;
  const MAX = 1500;
  $('list').innerHTML = items.slice(0, MAX).map((it) => {
    const ind = it.kind === 'table' || it.kind === 'figure' ? 0 : it.kind === 'requirement' ? 0 : Math.max(0, it.level - 1) * 12;
    const num = it.kind === 'section' ? '§' : it.kind === 'requirement' ? it.num.split('/')[1] + ' ' + it.num.split('/')[0] : it.num;
    const rc = reqCount.get(it.id);
    return `<div class="row ${S.sel?.id === it.id ? 'sel' : ''} ${inB.has(it.id) ? 'in-b' : ''}" data-id="${esc(it.id)}" style="--ind:${ind}px">
      <span class="num">${esc(num)}</span><span class="tt" title="${esc(it.title)}">${esc(it.title)}</span>${rc ? `<span class="rq" title="shall statements">${rc}</span>` : ''}<span class="k">${it.pageLabel ? 'p.' + esc(it.pageLabel) : ''}</span></div>`;
  }).join('') + (items.length > MAX ? `<div class="stat">… ${items.length - MAX} more, refine search</div>` : '');
}

// ---------- selection ----------
function regionsOf(it: IndexItem, full: boolean): IndexItem['regions'] { return full && it.full ? it.full : it.regions; }

function select(it: IndexItem, opts: { scroll?: boolean; fromList?: boolean } = {}): void {
  if (!S.viewer || !S.idx) return;
  if (it.kind === 'requirement') {
    S.selReq = it;
    S.sel = it.parent ? S.byId.get(it.parent) ?? it : it;
  } else { S.sel = it; S.selReq = null; S.full = false; }
  if (it.part !== S.part) setPart(it.part);
  paint();
  const target = S.selReq ?? S.sel;
  if (opts.scroll !== false && target.regions[0]) S.viewer.scrollToRect(target.regions[0], S.scrollMotion);
  renderDetail();
  document.querySelectorAll('#list .row.sel').forEach((r) => r.classList.remove('sel'));
  const row = document.querySelector(`#list .row[data-id="${CSS.escape(it.id)}"]`);
  row?.classList.add('sel');
  if (!opts.fromList) row?.scrollIntoView({ block: 'nearest' });
  if (opts.fromList && window.innerWidth <= 820) $('side').classList.remove('open');
}

function paint(): void {
  if (!S.viewer || !S.idx || !S.sel) { S.viewer?.setHighlights([]); return; }
  const groups: { rects: IndexItem['regions']; cls: string; id?: string }[] = [];
  if (S.sel.kind !== 'requirement') groups.push({ rects: regionsOf(S.sel, S.full), cls: 'main' });
  const reqs = S.idx.items.filter((i) => i.kind === 'requirement' && i.parent === S.sel!.id);
  reqs.forEach((r) => groups.push({ rects: r.regions, cls: S.selReq?.id === r.id ? 'req sel' : 'req', id: r.id }));
  if (S.sel.kind === 'requirement') groups.push({ rects: S.sel.regions, cls: 'req sel' });
  S.viewer.setHighlights(groups);
}

function onPageClick(page: number, x: number, y: number): void {
  if (!S.idx) return;
  const hit = hitTest(S.idx.items, S.part, page, x, y, true);
  if (!hit) return;
  // a click inside the selected clause on one of its shall statements selects that statement
  if (hit.kind === 'requirement' && S.sel && hit.parent !== S.sel.id) {
    const clause = hit.parent ? S.byId.get(hit.parent) : null;
    if (clause) { select(clause, { scroll: false }); return; }
  }
  select(hit, { scroll: false });
}

function renderDetail(): void {
  const d = $('detail');
  const it = S.selReq ?? S.sel;
  if (!it || !S.idx) { d.classList.remove('on'); return; }
  d.classList.add('on');
  const reqs = S.idx.items.filter((i) => i.kind === 'requirement' && i.parent === S.sel!.id);
  const full = it === S.sel && S.full;
  d.innerHTML = `
    <div class="cit">${esc(citation(S.idx, it, full))}</div>
    <div class="acts">
      <button class="pri" data-a="add">${S.basket.some((b) => b.id === it.id) ? '✓ In basket' : '+ Basket'}</button>
      <button data-a="copy">Copy text</button>
      <button data-a="cite">Copy citation</button>
      <button data-a="png">PNG</button>
      ${it.full && it === S.sel ? `<label><input type="checkbox" data-a="full" ${S.full ? 'checked' : ''}> incl. subclauses</label>` : ''}
      ${S.selReq ? `<button data-a="up">↑ ${esc(S.sel!.num || S.sel!.title)}</button>` : ''}
    </div>
    ${!S.selReq && reqs.length ? `<div class="reqs"><div style="background:none;border:0;padding:0;cursor:default;color:var(--mute)">${reqs.length} “shall” statement${reqs.length > 1 ? 's' : ''}:</div>${reqs.map((r) => `<div data-req="${esc(r.id)}"><b>${esc(r.num.split('/')[1])}</b> ${esc(r.text.length > 160 ? r.text.slice(0, 157) + '…' : r.text)}</div>`).join('')}</div>` : ''}
    <pre>${esc(textOf(it, full))}</pre>`;
}

function textOf(it: IndexItem, full: boolean): string {
  if (!full || !it.full || !S.idx) return it.text;
  // concatenate own text of this item and its descendants (non-requirement)
  const out: string[] = [];
  const walk = (id: string): void => {
    const x = S.byId.get(id)!;
    out.push(x.text);
    S.idx!.items.filter((c) => c.parent === id && c.kind !== 'requirement' && c.kind !== 'table' && c.kind !== 'figure').forEach((c) => walk(c.id));
  };
  walk(it.id);
  return out.join('\n\n');
}

// ---------- basket ----------
function persistBasket(): void { if (S.idx) saveBasket(S.idx.source.sha256, S.basket); $('bCount').textContent = String(S.basket.length); }

function toggleBasket(it: IndexItem, full: boolean): void {
  const i = S.basket.findIndex((b) => b.id === it.id);
  if (i >= 0) S.basket.splice(i, 1);
  else S.basket.push({ id: it.id, full, note: '', status: '' });
  persistBasket(); renderBasket(); renderDetail(); renderList();
}

function renderBasket(): void {
  persistBasket();
  if (!S.idx) return;
  $('blist').innerHTML = S.basket.length ? S.basket.map((b, i) => {
    const it = S.byId.get(b.id)!;
    return `<div class="bk" data-i="${i}">
      <div class="h"><b>${esc(it.kind === 'section' ? '§' : it.num)}</b><span data-go="${esc(it.id)}">${esc(it.title)}</span></div>
      <textarea data-note="${i}" placeholder="Note / evidence / gap rationale">${esc(b.note)}</textarea>
      <div class="ctl">
        <select data-st="${i}">${['', 'covered', 'partial', 'gap', 'n/a'].map((s) => `<option ${s === b.status ? 'selected' : ''} value="${s}">${s || 'status…'}</option>`).join('')}</select>
        ${it.full ? `<label><input type="checkbox" data-full="${i}" ${b.full ? 'checked' : ''}> subclauses</label>` : ''}
        <span style="flex:1"></span>
        <button data-mv="${i}:-1">↑</button><button data-mv="${i}:1">↓</button><button data-rm="${i}">✕</button>
      </div></div>`;
  }).join('') : '<div class="stat" style="padding:14px">Empty. Select a clause or definition and press “+ Basket”.</div>';
}

async function buildEntries(withImg: boolean): Promise<ReportEntry[]> {
  const out: ReportEntry[] = [];
  let k = 0;
  for (const b of S.basket) {
    const it = S.byId.get(b.id)!;
    progress(`Rendering ${++k}/${S.basket.length}…`, k / S.basket.length);
    const full = b.full && !!it.full;
    out.push({ item: it, full, note: b.note, status: b.status, text: textOf(it, full), img: withImg ? await regionsToImage(S.doc, regionsOf(it, full)) : null });
  }
  progress(null);
  return out;
}

async function reportHtml(): Promise<string | null> {
  if (!S.idx || !S.basket.length) { toast('Basket is empty'); return null; }
  const incImg = ($('oImg') as HTMLInputElement).checked;
  const entries = await buildEntries(incImg);
  return buildReport(S.idx, entries, { title: ($('rTitle') as HTMLInputElement).value || 'Extract', includeText: ($('oText') as HTMLInputElement).checked, includeImages: incImg });
}

// ---------- wiring ----------
function wire(): void {
  renderChips();
  const settings = $('settingsPanel');
  const settingsBtn = $('settingsBtn');
  const syncScrollMotion = (): void => {
    document.querySelectorAll<HTMLInputElement>('input[name="scrollMotion"]').forEach((input) => {
      input.checked = input.value === S.scrollMotion;
    });
  };
  const closeSettings = (): void => { settings.hidden = true; settingsBtn.setAttribute('aria-expanded', 'false'); };
  syncScrollMotion();
  settingsBtn.onclick = () => {
    settings.hidden = !settings.hidden;
    settingsBtn.setAttribute('aria-expanded', String(!settings.hidden));
  };
  $('closeSettings').onclick = closeSettings;
  document.addEventListener('click', (e) => {
    if (!settings.hidden && !settings.contains(e.target as Node) && !settingsBtn.contains(e.target as Node)) closeSettings();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });
  settings.onchange = (e) => {
    const input = e.target as HTMLInputElement;
    if (input.name !== 'scrollMotion') return;
    S.scrollMotion = input.value as ScrollMotion;
    saveScrollMotion(S.scrollMotion);
  };
  $('openPdf').onclick = () => $('fPdf').click();
  $('loadIdx').onclick = () => $('fIdx').click();
  ($('fPdf') as HTMLInputElement).onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void openPdf(f); (e.target as HTMLInputElement).value = ''; };
  ($('fIdx') as HTMLInputElement).onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = '';
    if (!f) return;
    try {
      const idx = normalizeIndex(JSON.parse(await f.text()));
      if (S.doc) {
        if (idx.source.sha256 !== S.sha) toast('Index was made for a different file');
        idx.source.sha256 = S.sha;
        await saveIndex(idx); setIndex(idx);
      } else { S.pendingIdx = idx; toast(`Index for ${idx.source.fileName} loaded — now open that PDF`); }
    } catch (err) { toast(`Invalid index: ${(err as Error).message}`); }
  };
  $('saveIdx').onclick = () => { if (S.idx) download(`${S.idx.source.fileName.replace(/\.pdf$/i, '')}.clause-index.json`, JSON.stringify(S.idx, null, 1), 'application/json'); };
  $('reIdx').onclick = async () => { if (!S.doc) return; try { const idx = await runAnalysis(); setIndex(idx); } finally { progress(null); } };
  ($('des') as HTMLInputElement).onchange = () => { if (!S.idx) return; S.idx.source.designation = ($('des') as HTMLInputElement).value.trim(); void saveIndex(S.idx); renderDetail(); };
  ($('part') as HTMLSelectElement).onchange = (e) => setPart((e.target as HTMLSelectElement).value);
  $('zIn').onclick = () => S.viewer?.setScale(S.viewer.scale * 1.2);
  $('zOut').onclick = () => S.viewer?.setScale(S.viewer.scale / 1.2);
  $('zFit').onclick = () => { if (!S.viewer) return; S.viewer.fitWidth(); S.viewer.setScale(S.viewer.scale); };
  $('sideBtn').onclick = () => $('side').classList.toggle('open');
  window.addEventListener('resize', () => { if (S.viewer && window.innerWidth <= 820) { S.viewer.fitWidth(); S.viewer.setScale(S.viewer.scale); } });

  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === `p-${b.dataset.tab}`));
  });
  let qT: ReturnType<typeof setTimeout>;
  $('q').oninput = () => { clearTimeout(qT); qT = setTimeout(() => {
    const q = ($('q') as HTMLInputElement).value.toLowerCase();
    if (/\bshall\b/.test(q) && !S.kinds.has('requirement')) { S.kinds.add('requirement'); renderChips(); }
    renderList();
  }, 120); };
  $('chips').onclick = (e) => {
    const k = (e.target as HTMLElement).dataset.k as ItemKind | undefined;
    if (!k) return;
    if (S.kinds.has(k)) S.kinds.delete(k); else S.kinds.add(k);
    renderChips(); renderList();
  };
  $('list').onclick = (e) => {
    const row = (e.target as HTMLElement).closest('.row') as HTMLElement | null;
    const it = row && S.byId.get(row.dataset.id!);
    if (it) select(it, { fromList: true });
  };
  $('detail').onclick = async (e) => {
    const t = e.target as HTMLElement;
    const it = S.selReq ?? S.sel;
    if (!it || !S.idx) return;
    const req = t.closest('[data-req]') as HTMLElement | null;
    if (req) { select(S.byId.get(req.dataset.req!)!); return; }
    const a = t.dataset.a;
    const full = it === S.sel && S.full;
    if (a === 'add') toggleBasket(it, full);
    else if (a === 'copy') await copy(`${citation(S.idx, it, full)}\n\n${textOf(it, full)}`);
    else if (a === 'cite') await copy(citation(S.idx, it, full));
    else if (a === 'png') { progress('Rendering image…', 0.5); try { const url = await regionsToImage(S.doc, regionsOf(it, full)); download(`${S.idx.source.designation.replace(/[^\w.-]+/g, '_')}_${(it.num || it.title).replace(/[^\w.-]+/g, '_')}.png`, await (await fetch(url)).blob()); } finally { progress(null); } }
    else if (a === 'full') { S.full = (t as HTMLInputElement).checked; paint(); renderDetail(); }
    else if (a === 'up') select(S.sel!);
  };
  $('blist').onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.go) { const it = S.byId.get(t.dataset.go); if (it) { S.full = false; select(it); } }
    if (t.dataset.rm) { S.basket.splice(Number(t.dataset.rm), 1); renderBasket(); renderList(); renderDetail(); }
    if (t.dataset.mv) {
      const [i, d] = t.dataset.mv.split(':').map(Number);
      const j = i + d; if (j < 0 || j >= S.basket.length) return;
      [S.basket[i], S.basket[j]] = [S.basket[j], S.basket[i]]; renderBasket();
    }
  };
  $('blist').oninput = (e) => { const t = e.target as HTMLTextAreaElement; if (t.dataset.note) { S.basket[Number(t.dataset.note)].note = t.value; persistBasket(); } };
  $('blist').onchange = (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.st) { S.basket[Number(t.dataset.st)].status = t.value; persistBasket(); }
    if (t.dataset.full) { S.basket[Number(t.dataset.full)].full = t.checked; persistBasket(); }
  };
  $('clearB').onclick = () => {
    const b = $('clearB');
    if (!S.basket.length) return;
    if (b.dataset.arm !== '1') { b.dataset.arm = '1'; b.textContent = 'Tap again to clear'; setTimeout(() => { b.dataset.arm = ''; b.textContent = 'Clear'; }, 2500); return; }
    b.dataset.arm = ''; b.textContent = 'Clear';
    S.basket = []; renderBasket(); renderList(); renderDetail();
  };
  $('expReport').onclick = async () => { const h = await reportHtml(); if (h) download(`${(($('rTitle') as HTMLInputElement).value || 'extract').replace(/[^\w.-]+/g, '_')}.html`, h, 'text/html'); };
  $('printReport').onclick = async () => {
    const h = await reportHtml(); if (!h) return;
    if (hosted()) { download('report.html', h, 'text/html'); toast('Open the saved report and use its Print button'); return; }
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.append(fr);
    fr.srcdoc = h;
    fr.onload = () => { try { fr.contentWindow!.focus(); fr.contentWindow!.print(); } catch { download('report.html', h, 'text/html'); toast('Printing blocked here — report downloaded instead'); } setTimeout(() => fr.remove(), 60000); };
  };
  $('copyAll').onclick = async () => {
    if (!S.idx || !S.basket.length) return;
    const parts = S.basket.map((b) => { const it = S.byId.get(b.id)!; const full = b.full && !!it.full; return `${citation(S.idx!, it, full)}${b.status ? ` [${b.status}]` : ''}${b.note ? `\nNote: ${b.note}` : ''}\n\n${textOf(it, full)}`; });
    await copy(parts.join('\n\n———\n\n'));
  };

  // drag & drop
  const view = $('view');
  view.addEventListener('dragover', (e) => { e.preventDefault(); view.classList.add('drop'); });
  view.addEventListener('dragleave', () => view.classList.remove('drop'));
  view.addEventListener('drop', (e) => {
    e.preventDefault(); view.classList.remove('drop');
    const f = e.dataTransfer?.files?.[0];
    if (f && /pdf$/i.test(f.name)) void openPdf(f);
  });
  // keyboard: j/k next/prev item in list
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input,textarea,select') || !S.sel) return;
    if (e.key !== 'j' && e.key !== 'k') return;
    const rows = [...document.querySelectorAll<HTMLElement>('#list .row')];
    const i = rows.findIndex((r) => r.classList.contains('sel'));
    const n = rows[i + (e.key === 'j' ? 1 : -1)];
    const it = n && S.byId.get(n.dataset.id!);
    if (it) select(it);
  });
}

function boot(): void {
  wire();
  const idle = (cb: () => void): void => { if ('requestIdleCallback' in window) (window as any).requestIdleCallback(cb); else setTimeout(cb, 1); };
  idle(setupWorker);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
