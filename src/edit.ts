/* Edit mode: toggle, entry/group CRUD, inline group rename. */

import { CONFIG, persist, flushGist, rerender, isAway, setEditModeFlag, importing } from './state';
import { render, closeSlideout } from './render';
import { flipElement, wireEntryDnD } from './dnd';
import { openEntryModal } from './modals';
import { pruneIconCache, iconSpan } from './icons';

export function setEditMode(on: boolean): void {
  // Editing is locked while a gist import is in flight.
  if (on && importing) return;

  // Capture group geometry by index so the add-row show/hide resize can ease.
  const prev = [...document.querySelectorAll<HTMLElement>('#container > .group')].map(g => {
    const r = g.getBoundingClientRect();
    return { left: r.left, top: r.top, height: r.height };
  });

  setEditModeFlag(on);
  document.body.classList.toggle('edit-mode', on);
  document.getElementById('toggle-edit')!.classList.toggle('on', on);
  closeSlideout();
  render(isAway());

  document.querySelectorAll<HTMLElement>('#container > .group').forEach((g, i) => {
    if (prev[i]) flipElement(g, prev[i], true);
  });

  // Leaving edit mode: push the whole session's changes as one gist revision.
  if (!on) flushGist();
}

export function addEntryTo(gi: number): void {
  // Added in-memory so the modal can edit it; committed only on Save (Cancel removes it).
  CONFIG.groups[gi].entries.push({ name: '', icon: 'bi:box-fill', check: false, links: [] });
  rerender();
  openEntryModal(gi, CONFIG.groups[gi].entries.length - 1, true);
}

export function deleteEntry(gi: number, ei: number): void {
  const e = CONFIG.groups[gi].entries[ei];
  if (!confirm(`Delete "${e.name}"?`)) return;
  CONFIG.groups[gi].entries.splice(ei, 1);
  pruneIconCache();
  persist();
  rerender();
}

export function addNewGroup(): void {
  CONFIG.groups.push({ group: 'New group', entries: [] });
  persist();
  rerender();
}

function deleteGroup(gi: number): void {
  if (!confirm(`Delete group "${CONFIG.groups[gi].group}" and all its entries?`)) return;
  CONFIG.groups.splice(gi, 1);
  pruneIconCache();
  persist();
  rerender();
}

/** Make a rendered group editable: inline title, delete button, entry DnD. */
export function wireGroupEditing(groupDiv: HTMLElement, gi: number): void {
  const title = groupDiv.querySelector<HTMLElement>('.group-title')!;
  title.setAttribute('contenteditable', 'true');
  title.spellcheck = false;
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  title.addEventListener('blur', () => {
    const v = (title.textContent ?? '').trim() || 'Untitled';
    title.textContent = v;
    if (CONFIG.groups[gi].group !== v) { CONFIG.groups[gi].group = v; persist(); }
  });

  const del = document.createElement('span');
  del.className = 'group-delete';
  del.title = 'Delete group';
  del.appendChild(iconSpan('trash-fill'));
  del.addEventListener('click', () => deleteGroup(gi));
  groupDiv.querySelector('.group-header')!.appendChild(del);

  wireEntryDnD(groupDiv);
}
