/* DOM rendering: groups, entries, the long-press overlay, and health dots. */

import { CONFIG, editMode, openWrap, setOpenWrap } from './state';
import { orderLinks, isInternal, probeService, isProbeable } from './probes';
import { iconMarkup, iconSpan, gripSpan } from './icons';
import { openEntryModal } from './modals';
import { addEntryTo, deleteEntry, addNewGroup, wireGroupEditing } from './edit';
import { wireGroupDnD } from './dnd';
import { openContextMenu } from './menu';
import { isTouch } from './touch';
import { safeUrl } from './util';
import type { Entry } from './types';

const LONG_PRESS_MS = 400; // hold duration to open the overlay
const PRESS_SLOP    = 10;  // px of travel that turns a hold into a scroll/drag

/* ---- slideout overlay (one open at a time) ---- */

export function closeSlideout(): void {
  if (openWrap) { openWrap.classList.remove('open'); setOpenWrap(null); }
}
function openSlideout(wrap: HTMLElement): void {
  if (openWrap && openWrap !== wrap) closeSlideout();
  wrap.classList.add('open');
  setOpenWrap(wrap);
}

/* ---- entry ---- */

function buildEntry(entry: Entry, away: boolean, gi: number, ei: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'entry-wrap';
  wrap.dataset.group = String(gi);
  wrap.dataset.entry = String(ei);

  const links = entry.links || [];
  const ordered = orderLinks(links, away);
  const hasLinks = ordered.length > 0;
  const reachable = !away || !hasLinks || !isInternal(ordered[0].url);
  if (!reachable) wrap.classList.add('unreachable');

  const row = document.createElement('div');
  row.className = 'entry';

  // Touch, in edit mode: a grip at the head of the row is the only thing that
  // starts a drag, so a finger anywhere else on it still scrolls the page.
  if (editMode && isTouch) {
    const grip = gripSpan();
    grip.classList.add('drag-handle');
    row.appendChild(grip);
  }

  row.appendChild(iconMarkup(entry.icon));

  const nameEl = document.createElement('span');
  nameEl.className = 'entry-name';
  nameEl.textContent = entry.name;
  row.appendChild(nameEl);

  // "More" indicator - always present for column alignment, hidden when single.
  const more = iconSpan('three-dots-vertical');
  more.classList.add('entry-more');
  if (ordered.length <= 1) more.classList.add('placeholder');
  row.appendChild(more);

  // Health dot - only with checks enabled, at Home, with a probeable target.
  // The target defaults to the first link but an entry can override it
  // (entry.checkUrl): a service that blocks the cross-origin fetch of its main
  // page (CORS/CORP) or sits behind auth can be checked at a dedicated health
  // endpoint while the tile still opens the first link. (On the hosted build,
  // http targets aren't probeable, so their dots are omitted rather than shown
  // perpetually "down".)
  const probeTarget = (entry.checkUrl || '').trim() || (hasLinks ? ordered[0].url : '');
  if (entry.check && !away && probeTarget && isProbeable(probeTarget)) {
    const status = document.createElement('span');
    status.className = 'entry-status checking';
    // Colour-blind friendly mode: pre-mount both glyphs; CSS reveals the one
    // matching the up/down class, so runServiceProbes stays untouched.
    if (CONFIG.colorBlind) {
      status.classList.add('glyphs');
      const up = iconSpan('check-lg'); up.classList.add('glyph-up');
      const down = iconSpan('x-lg'); down.classList.add('glyph-down');
      status.append(up, down);
    }
    status.dataset.probeUrl = probeTarget;
    row.insertBefore(status, more);
  }

  // Edit affordances (CSS-gated to edit mode).
  const actions = document.createElement('span');
  actions.className = 'entry-actions';
  const editBtn = document.createElement('span');
  editBtn.className = 'entry-action';
  editBtn.title = 'Edit';
  editBtn.appendChild(iconSpan('pencil-fill'));
  editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEntryModal(gi, ei); });
  const delBtn = document.createElement('span');
  delBtn.className = 'entry-action danger';
  delBtn.title = 'Delete';
  delBtn.appendChild(iconSpan('trash-fill'));
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteEntry(gi, ei); });
  actions.append(editBtn, delBtn);
  row.appendChild(actions);

  wrap.appendChild(row);

  // Overlay - only for entries with more than one link.
  if (ordered.length > 1) {
    const overlay = document.createElement('div');
    overlay.className = 'entry-overlay';
    ordered.forEach(link => {
      const a = document.createElement('a');
      a.className = 'overlay-link';
      a.href = safeUrl(link.url) || '#'; // never let javascript:/data: reach href
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = link.url;
      a.textContent = link.label;
      a.addEventListener('click', () => closeSlideout());
      overlay.appendChild(a);
    });
    wrap.appendChild(overlay);
  }

  // Edit mode: the row is inert apart from dragging and its edit affordances.
  // With a mouse those are the inline icons the row reveals on hover; a finger
  // has no hover, so touch opens the same two actions as a menu on the row -
  // the three-dots stay visible in edit mode (CSS) to advertise it.
  if (editMode) {
    if (isTouch) {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.drag-handle')) return;
        openContextMenu(row, [
          { label: 'Edit',   icon: 'pencil-fill', onSelect: () => openEntryModal(gi, ei) },
          { label: 'Delete', icon: 'trash-fill', danger: true, onSelect: () => deleteEntry(gi, ei) }
        ]);
      });
    }
    return wrap;
  }

  // Click vs long-press via pointer events. (Secondary links are real <a>s in
  // the overlay, so they remain in the natural tab order.)
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressed = false;
  let pressX = 0, pressY = 0;
  const startPress = (e: PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    longPressed = false;
    pressX = e.clientX; pressY = e.clientY;
    clearTimeout(pressTimer);
    if (ordered.length > 1) pressTimer = setTimeout(() => { longPressed = true; openSlideout(wrap); }, LONG_PRESS_MS);
  };
  // A hold that travels is a scroll (or a drag), not a long press: drop the
  // timer so starting a touch-scroll on an entry doesn't slide the overlay in.
  const movePress = (e: PointerEvent) => {
    if (pressTimer === undefined) return;
    if (Math.abs(e.clientX - pressX) > PRESS_SLOP || Math.abs(e.clientY - pressY) > PRESS_SLOP) cancelPress();
  };
  const endPress = () => { clearTimeout(pressTimer); pressTimer = undefined; };
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = undefined; longPressed = false; };

  row.addEventListener('pointerdown',   startPress);
  row.addEventListener('pointermove',   movePress);
  row.addEventListener('pointerup',     endPress);
  row.addEventListener('pointerleave',  cancelPress);
  row.addEventListener('pointercancel', cancelPress);
  row.addEventListener('click', (e) => {
    if (longPressed) { e.preventDefault(); e.stopPropagation(); longPressed = false; return; }
    if (wrap.classList.contains('open')) { e.preventDefault(); closeSlideout(); return; }
    if (hasLinks) { const target = safeUrl(ordered[0].url); if (target) window.open(target, '_blank', 'noopener,noreferrer'); }
  });
  row.addEventListener('contextmenu', (e) => e.preventDefault());

  // Tapping the "more" dots reveals the overlay too (a discoverable alternative
  // to long-press); stopPropagation keeps the row's primary-open from firing.
  if (ordered.length > 1) {
    more.addEventListener('click', (e) => { e.stopPropagation(); openSlideout(wrap); });
  }

  return wrap;
}

/* ---- full render ---- */

/** Bumped each render; async probes ignore their result if it moves on. */
let renderToken = 0;

export function render(away: boolean): void {
  renderToken++;
  const token = renderToken;
  const container = document.getElementById('container')!;
  container.innerHTML = '';
  closeSlideout();

  CONFIG.groups.forEach((group, gi) => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'group';
    groupDiv.dataset.group = String(gi);

    const header = document.createElement('div');
    header.className = 'group-header';
    const title = document.createElement('span');
    title.className = 'group-title';
    title.textContent = group.group;
    header.appendChild(title);
    groupDiv.appendChild(header);

    const entriesDiv = document.createElement('div');
    entriesDiv.className = 'entries';
    (group.entries || []).forEach((entry, ei) => entriesDiv.appendChild(buildEntry(entry, away, gi, ei)));

    const addEntry = document.createElement('div');
    addEntry.className = 'add-entry';
    addEntry.append(iconSpan('plus-lg'), Object.assign(document.createElement('span'), { textContent: 'Add entry' }));
    addEntry.addEventListener('click', () => addEntryTo(gi));
    entriesDiv.appendChild(addEntry);

    groupDiv.appendChild(entriesDiv);
    container.appendChild(groupDiv);

    if (editMode) wireGroupEditing(groupDiv, gi);
  });

  const addGroup = document.createElement('div');
  addGroup.className = 'add-group';
  addGroup.appendChild(iconSpan('plus-lg'));
  addGroup.addEventListener('click', addNewGroup);
  container.appendChild(addGroup);

  if (editMode) wireGroupDnD();

  runServiceProbes(token);
}

/** Fire a probe per visible health dot; update silently on completion. */
export function runServiceProbes(token = renderToken): void {
  document.querySelectorAll<HTMLElement>('.entry-status[data-probe-url]').forEach(dot => {
    probeService(dot.dataset.probeUrl!).then(state => {
      if (token !== renderToken) return;
      dot.classList.remove('checking', 'up', 'down');
      dot.classList.add(state);
    });
  });
}
