/* Edit mode: toggle, entry/group CRUD, inline group rename. */

import { CONFIG, persist, flushGist, rerender, isAway, setEditModeFlag, importing } from './state';
import { render, closeSlideout } from './render';
import { flipElement, wireEntryDnD } from './dnd';
import { openEntryModal } from './modals';
import { pruneIconCache, iconSpan, gripSpan, spanIconSpan } from './icons';
import { isTouch } from './touch';
import type { GroupSpan } from './types';

/** Apply `change`, re-render, and ease each group from its old box to its new
   one. render() rebuilds every element, so groups are matched by index. */
function renderEasingGroups(change: () => void): void {
  const prev = [...document.querySelectorAll<HTMLElement>('#container > .group')].map(g => {
    const r = g.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });

  change();
  render(isAway());

  document.querySelectorAll<HTMLElement>('#container > .group').forEach((g, i) => {
    if (prev[i]) flipElement(g, prev[i], true);
  });
}

export function setEditMode(on: boolean): void {
  // Editing is locked while a gist import is in flight.
  if (on && importing) return;

  // Eased, so the add rows appearing/disappearing don't jolt the groups.
  renderEasingGroups(() => {
    setEditModeFlag(on);
    document.body.classList.toggle('edit-mode', on);
    document.getElementById('toggle-edit')!.classList.toggle('on', on);
    closeSlideout();
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

/** Toggle a group's double-size layout; the other span is off while one is on. */
function toggleGroupSpan(gi: number, span: GroupSpan): void {
  const g = CONFIG.groups[gi];
  renderEasingGroups(() => {
    if (g.span === span) delete g.span;
    else g.span = span;
    persist();
  });
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

  const header = groupDiv.querySelector('.group-header')!;
  const actions = document.createElement('span');
  actions.className = 'group-actions';

  const current = CONFIG.groups[gi].span;
  const spanToggle = (span: GroupSpan, label: string, other: string): HTMLElement => {
    const btn = document.createElement('span');
    btn.className = 'group-span';
    btn.appendChild(spanIconSpan(span));
    if (current === span) {
      btn.classList.add('on');
      btn.title = `${label}: on`;
    } else if (current) {
      btn.classList.add('disabled');
      btn.title = `${label} - turn off ${other} first`;
    } else {
      btn.title = label;
    }
    btn.addEventListener('click', () => { if (!btn.classList.contains('disabled')) toggleGroupSpan(gi, span); });
    return btn;
  };

  const del = document.createElement('span');
  del.className = 'group-delete';
  del.title = 'Delete group';
  del.appendChild(iconSpan('trash-fill'));
  del.addEventListener('click', () => deleteGroup(gi));

  actions.append(
    spanToggle('wide', 'Double width', 'double height'),
    spanToggle('tall', 'Double height', 'double width'),
    del
  );
  header.appendChild(actions);

  // Touch drags the group by its grip, not the whole header - the header holds
  // the tappable title and delete button, and the page still has to scroll.
  // It leads the header, matching the grip on each entry row.
  if (isTouch) {
    const grip = gripSpan();
    grip.classList.add('drag-handle');
    header.insertBefore(grip, header.firstChild);
  }

  wireEntryDnD(groupDiv);
}
