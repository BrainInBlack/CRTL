/* Anchored context menu - the touch stand-in for the hover-revealed inline
   icons. A finger has no hover state to reveal them with, and shrinking a
   14px glyph into a thumb target is a losing game, so on touch the same
   actions open as a menu next to the row instead. */

import { iconSpan } from './icons';

export interface MenuItem {
  label: string;
  /** Bootstrap icon name, e.g. 'pencil-fill'. */
  icon: string;
  danger?: boolean;
  onSelect: () => void;
}

const GAP  = 6; // px between the anchor and the menu
const EDGE = 8; // px kept clear of the viewport edges

let openBackdrop: HTMLElement | null = null;

export function closeContextMenu(): void {
  if (!openBackdrop) return;
  openBackdrop.remove();
  openBackdrop = null;
  window.removeEventListener('resize', closeContextMenu);
  window.removeEventListener('scroll', closeContextMenu, true);
}

/** Park the menu under `anchor`, flipping above it and clamping sideways so it
   always lands fully on screen (a row near the bottom edge is the common case). */
function position(menu: HTMLElement, anchor: HTMLElement): void {
  const a = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const top = a.bottom + GAP + m.height > window.innerHeight - EDGE
    ? Math.max(EDGE, a.top - GAP - m.height)
    : a.bottom + GAP;
  const left = Math.max(EDGE, Math.min(a.left, window.innerWidth - EDGE - m.width));
  menu.style.top  = top + 'px';
  menu.style.left = left + 'px';
}

export function openContextMenu(anchor: HTMLElement, items: MenuItem[]): void {
  closeContextMenu();

  const backdrop = document.createElement('div');
  backdrop.className = 'menu-backdrop';
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'menu-item' + (item.danger ? ' danger' : '');
    row.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.textContent = item.label;
    row.append(iconSpan(item.icon), label);
    // Close first: the action may re-render (or open a modal) underneath us.
    row.addEventListener('click', () => { closeContextMenu(); item.onSelect(); });
    menu.appendChild(row);
  });

  backdrop.appendChild(menu);
  document.body.appendChild(backdrop);
  openBackdrop = backdrop;

  position(menu, anchor);
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) closeContextMenu(); });
  // The menu is anchored in viewport coordinates, so anything that moves the
  // anchor underneath it dismisses rather than drifts.
  window.addEventListener('resize', closeContextMenu);
  window.addEventListener('scroll', closeContextMenu, true);

  requestAnimationFrame(() => backdrop.classList.add('open'));
}
