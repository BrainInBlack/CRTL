/* Hand-rolled pointer drag-and-drop (mouse + touch) with a live placeholder and
   FLIP reflow animation. Used for entries (within/across groups) and groups. */

import { CONFIG, persist, rerender } from './state';
import { isTouch } from './touch';
import type { DragOptions, DragZone, Rect } from './types';

interface DragState {
  item: HTMLElement;
  placeholder: HTMLElement;
  opts: DragOptions;
  dx: number;
  dy: number;
  pointerId: number;
}

/** An armed press that has not become a drag yet. The item only lifts once the
   pointer travels DRAG_SLOP, so a plain tap picks nothing up - and on touch a
   press that turns into a page scroll is cancelled by the browser before
   anything has moved. */
interface PendingDrag {
  item: HTMLElement;
  opts: DragOptions;
  x: number;
  y: number;
  pointerId: number;
}

const DRAG_SLOP = 5; // px of travel before a press counts as a drag

let pending: PendingDrag | null = null;
let dragState: DragState | null = null;

const pointInRect = (e: PointerEvent, r: DOMRect) =>
  e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;

function nearestZone(zones: DragZone[], e: PointerEvent): DragZone | null {
  let best: DragZone | null = null, bestD = Infinity;
  zones.forEach(z => {
    const r = z.container.getBoundingClientRect();
    const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
    const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = z; }
  });
  return best;
}

/** Vertical list: insert before the first item whose mid-Y is past the pointer. */
export function resolveY(items: HTMLElement[], e: PointerEvent): HTMLElement | null {
  for (const it of items) {
    const r = it.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) return it;
  }
  return null;
}

/** Wrapping grid: insert before the first item following the pointer in reading order. */
function resolveGrid(items: HTMLElement[], e: PointerEvent): HTMLElement | null {
  for (const it of items) {
    const r = it.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (e.clientY < cy - r.height / 2) return it;
    if (Math.abs(cy - e.clientY) < r.height / 2 && e.clientX < cx) return it;
  }
  return null;
}

/** Arm a drag on `item`: it lifts once the pointer moves past DRAG_SLOP. */
export function startDrag(e: PointerEvent, item: HTMLElement, opts: DragOptions): void {
  if (e.button !== undefined && e.button !== 0) return;
  if (pending || dragState) return; // one drag at a time (a second finger is ignored)
  pending = { item, opts, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  document.addEventListener('pointermove', onPendingMove);
  document.addEventListener('pointerup', clearPending);
  document.addEventListener('pointercancel', clearPending);
}

function clearPending(): void {
  pending = null;
  document.removeEventListener('pointermove', onPendingMove);
  document.removeEventListener('pointerup', clearPending);
  document.removeEventListener('pointercancel', clearPending);
}

function onPendingMove(e: PointerEvent): void {
  if (!pending || e.pointerId !== pending.pointerId) return;
  if (Math.abs(e.clientX - pending.x) < DRAG_SLOP && Math.abs(e.clientY - pending.y) < DRAG_SLOP) return;
  const { item, opts } = pending;
  clearPending();
  lift(e, item, opts);
}

/** Lift `item` under the cursor; a same-size placeholder takes its slot. */
function lift(e: PointerEvent, item: HTMLElement, opts: DragOptions): void {
  e.preventDefault();

  const rect = item.getBoundingClientRect();
  const placeholder = document.createElement('div');
  placeholder.className = 'drag-placeholder';
  placeholder.style.width = rect.width + 'px';
  placeholder.style.height = rect.height + 'px';
  placeholder.style.margin = getComputedStyle(item).margin;
  item.parentNode!.insertBefore(placeholder, item);

  item.classList.add('dragging');
  Object.assign(item.style, {
    position: 'fixed', zIndex: '1000',
    width: rect.width + 'px', height: rect.height + 'px',
    left: rect.left + 'px', top: rect.top + 'px',
    margin: '0', pointerEvents: 'none'
  });

  dragState = { item, placeholder, opts, dx: e.clientX - rect.left, dy: e.clientY - rect.top, pointerId: e.pointerId };
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragCancel);
}

function detachDrag(): void {
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('pointercancel', onDragCancel);
}

function onDragMove(e: PointerEvent): void {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  e.preventDefault();
  const { item, placeholder, opts, dx, dy } = dragState;

  item.style.left = (e.clientX - dx) + 'px';
  item.style.top  = (e.clientY - dy) + 'px';

  const zones = opts.getZones();
  const zone = zones.find(z => pointInRect(e, z.container.getBoundingClientRect())) || nearestZone(zones, e);
  if (!zone) return;
  const items = zone.items.filter(it => it !== item && it !== placeholder);
  const before = opts.resolve(items, e);
  // Trailing "add" affordance counts as the end, so dropping last lands above it.
  const ref = before || zone.container.querySelector(':scope > .add-entry, :scope > .add-group') || null;

  if (placeholder.parentNode === zone.container && placeholder.nextSibling === ref) return;
  flipReorder(() => {
    if (ref) zone.container.insertBefore(placeholder, ref);
    else zone.container.appendChild(placeholder);
  });
}

/* ---- FLIP reflow ---- */

const FLIP_MS = 160;

/**
 * Animate `el` from captured rect `f` to its current geometry: position via a
 * transform transition; group height via the Web Animations API (a CSS height
 * transition would be wiped by the next move's transform reset).
 */
export function flipElement(el: HTMLElement, f: Rect, animateHeight?: boolean): void {
  const r = el.getBoundingClientRect();
  const ox = f.left - r.left, oy = f.top - r.top;
  if (ox || oy) {
    el.style.transition = 'none';
    el.style.transform = `translate(${ox}px, ${oy}px)`;
    el.getBoundingClientRect();            // lock the inverted start
    el.style.transition = `transform ${FLIP_MS}ms ease`;
    el.style.transform = '';
  }
  if (animateHeight && Math.abs(f.height - r.height) > 0.5) {
    el.style.overflow = 'hidden';
    el._hAnim = el.animate(
      [{ height: f.height + 'px' }, { height: r.height + 'px' }],
      { duration: FLIP_MS, easing: 'ease' }
    );
    el._hAnim.onfinish = el._hAnim.oncancel = () => { el.style.overflow = ''; };
  }
}

function flipReorder(mutate: () => void): void {
  const ds = dragState;
  if (!ds) return;
  const els = [...document.querySelectorAll<HTMLElement>('#container > .group, .entry-wrap, .drag-placeholder')]
    .filter(el => el !== ds.item);
  const first = new Map<HTMLElement, Rect>();
  els.forEach(el => { const r = el.getBoundingClientRect(); first.set(el, { left: r.left, top: r.top, height: r.height }); });
  mutate();
  els.forEach(el => {
    const isGroup = el.classList.contains('group');
    // Cancel an in-flight height animation so flipElement reads the true height.
    if (isGroup && el._hAnim) { el._hAnim.cancel(); el._hAnim = null; }
    flipElement(el, first.get(el)!, isGroup);
  });
}

function onDragEnd(e: PointerEvent): void {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const { item, placeholder, opts } = dragState;
  detachDrag();
  opts.onCommit(item, placeholder); // commits, then re-renders away the floats
  dragState = null;
}

/**
 * The browser took the gesture over (a touch that became a page scroll) or the
 * pointer was otherwise lost. Put everything back where it was: without this
 * the item stays lifted (position: fixed) next to an orphan placeholder, and
 * dragState never clears - no further drag can start.
 */
function onDragCancel(e: PointerEvent): void {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const { item, placeholder } = dragState;
  detachDrag();
  flipReorder(() => placeholder.remove()); // ease the gap closed (reads dragState)
  dragState = null;
  item.classList.remove('dragging');
  item.removeAttribute('style'); // the item never moved in the DOM - only its styling did
}

/* ---- wiring + commits ---- */

/** Entries - draggable within and across groups. */
export function wireEntryDnD(groupDiv: HTMLElement): void {
  groupDiv.querySelectorAll<HTMLElement>(':scope .entry-wrap').forEach(wrap => {
    const row = wrap.querySelector<HTMLElement>('.entry');
    if (!row) return;
    // A mouse grabs the row anywhere; a finger grabs the grip only, leaving the
    // rest of the row free to scroll the page (the grip opts out via
    // touch-action, so the browser hands the gesture over instead of scrolling).
    const from = isTouch ? wrap.querySelector<HTMLElement>('.drag-handle') : row;
    if (!from) return;
    from.addEventListener('pointerdown', (e) => {
      if (!isTouch && (e.target as HTMLElement).closest('.entry-actions')) return; // leave buttons clickable
      startDrag(e, wrap, {
        resolve: resolveY,
        getZones: () => [...document.querySelectorAll<HTMLElement>('.group .entries')].map(c => ({
          container: c,
          items: [...c.querySelectorAll<HTMLElement>(':scope > .entry-wrap')]
        })),
        onCommit: commitEntryMove
      });
    });
  });
}

function commitEntryMove(wrap: HTMLElement, placeholder: HTMLElement): void {
  const fromG = +wrap.dataset.group!, fromE = +wrap.dataset.entry!;
  const toG = +placeholder.parentElement!.closest<HTMLElement>('.group')!.dataset.group!;
  let toIndex = 0;
  for (let n = placeholder.previousElementSibling; n; n = n.previousElementSibling) {
    if (n.classList.contains('entry-wrap') && n !== wrap) toIndex++;
  }
  const [moved] = CONFIG.groups[fromG].entries.splice(fromE, 1);
  CONFIG.groups[toG].entries.splice(toIndex, 0, moved);
  persist();
  rerender();
}

/** Groups - draggable in the grid; the whole header is the handle (grip on touch). */
export function wireGroupDnD(): void {
  document.querySelectorAll<HTMLElement>('#container > .group').forEach(g => {
    const header = g.querySelector<HTMLElement>('.group-header');
    if (!header) return;
    const from = isTouch ? header.querySelector<HTMLElement>('.drag-handle') : header;
    if (!from) return;
    from.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (!isTouch && (t.closest('.group-title') || t.closest('.group-delete'))) return;
      startDrag(e, g, {
        resolve: resolveGrid,
        getZones: () => [{
          container: document.getElementById('container')!,
          items: [...document.querySelectorAll<HTMLElement>('#container > .group')]
        }],
        onCommit: commitGroupMove
      });
    });
  });
}

function commitGroupMove(groupEl: HTMLElement, placeholder: HTMLElement): void {
  const from = +groupEl.dataset.group!;
  let toIndex = 0;
  for (let n = placeholder.previousElementSibling; n; n = n.previousElementSibling) {
    if (n.classList.contains('group') && n !== groupEl) toIndex++;
  }
  const [moved] = CONFIG.groups.splice(from, 1);
  CONFIG.groups.splice(toIndex, 0, moved);
  persist();
  rerender();
}
