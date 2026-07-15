/* DOM rendering: groups, entries, the long-press overlay, and health dots. */

import { CONFIG, editMode, openWrap, setOpenWrap } from './state';
import { orderLinks, isInternal, probeService, isProbeable } from './probes';
import { iconMarkup, iconSpan } from './icons';
import { openEntryModal } from './modals';
import { addEntryTo, deleteEntry, addNewGroup, wireGroupEditing } from './edit';
import { wireGroupDnD } from './dnd';
import { safeUrl } from './util';
import type { Entry } from './types';

const LONG_PRESS_MS = 400; // hold duration to open the overlay

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
  // (On the hosted build, http targets aren't probeable, so their dots are
  // omitted rather than shown perpetually "down".)
  if (entry.check && !away && hasLinks && isProbeable(ordered[0].url)) {
    const status = document.createElement('span');
    status.className = 'entry-status checking';
    // Colour-blind friendly mode: pre-mount both glyphs; CSS shows the one
    // matching the up/down class, so runServiceProbes stays untouched.
    if (CONFIG.colorBlind) {
      status.classList.add('glyphs');
      const up = iconSpan('check-lg'); up.classList.add('glyph-up');
      const down = iconSpan('x-lg'); down.classList.add('glyph-down');
      status.append(up, down);
    }
    status.dataset.probeUrl = ordered[0].url;
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

  if (editMode) return wrap; // row is inert in edit mode (drag + buttons only)

  // Click vs long-press via pointer events. (Secondary links are real <a>s in
  // the overlay, so they remain in the natural tab order.)
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressed = false;
  const startPress = (e: PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    longPressed = false;
    clearTimeout(pressTimer);
    if (ordered.length > 1) pressTimer = setTimeout(() => { longPressed = true; openSlideout(wrap); }, LONG_PRESS_MS);
  };
  const endPress = () => { clearTimeout(pressTimer); pressTimer = undefined; };
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = undefined; longPressed = false; };

  row.addEventListener('pointerdown',   startPress);
  row.addEventListener('pointerup',     endPress);
  row.addEventListener('pointerleave',  cancelPress);
  row.addEventListener('pointercancel', cancelPress);
  row.addEventListener('click', (e) => {
    if (longPressed) { e.preventDefault(); e.stopPropagation(); longPressed = false; return; }
    if (wrap.classList.contains('open')) { e.preventDefault(); closeSlideout(); return; }
    if (hasLinks) { const target = safeUrl(ordered[0].url); if (target) window.open(target, '_blank', 'noopener'); }
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
