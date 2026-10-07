/* Entry editor: name, icon (picker + brand-set chooser), health check, and the
   draggable link list. */

import { CONFIG, persist, rerender } from './state';
import { embedIcon, iconEl, gripSpan, pruneIconCache, findBrandSets } from './icons';
import { BI_ICONS } from './icon-list';
import { startDrag, resolveY } from './dnd';
import { errMsg, safeUrl } from './util';
import { buildModal, closeModal, fieldText } from './modals';
import type { Link } from './types';

// Scheme is optional in a link field: a bare host becomes https://; an explicitly
// typed http://|https:// is kept. Only the default https:// is hidden in the
// field (http:// stays visible and round-trips via the first branch), so an
// unchanged scheme-less value maps back to its https:// original - and deleting
// a visible http:// reads as intent to upgrade to the https default.
function resolveLinkUrl(input: HTMLInputElement): string {
  const raw = input.value.trim();
  if (!raw) return '';
  // safeUrl on every branch: `orig` can carry a pre-existing javascript:/data:
  // value (the "unchanged, keep original scheme" branch would otherwise let it
  // survive an edit), and it hardens the explicit-scheme branch too.
  if (/^https?:\/\//i.test(raw)) return safeUrl(raw);
  const orig = input.dataset.orig || '';
  if (orig && raw === orig.replace(/^https:\/\//i, '')) return safeUrl(orig);
  return safeUrl('https://' + raw);
}

export function openEntryModal(gi: number, ei: number, isNew?: boolean): void {
  const entry = CONFIG.groups[gi].entries[ei];
  const { backdrop, body, foot } = buildModal(isNew ? 'New entry' : 'Edit entry');

  // A brand-new entry abandoned (Cancel/backdrop/Esc) is removed again.
  let saved = false;
  backdrop._onClose = () => {
    if (isNew && !saved) { CONFIG.groups[gi].entries.splice(ei, 1); pruneIconCache(); rerender(); }
  };

  const name = fieldText('Name', entry.name);
  name.input.placeholder = 'Service name';
  body.appendChild(name.field);

  // Icon: live preview + text id + Bootstrap picker.
  const iconField = document.createElement('div'); iconField.className = 'field';
  iconField.innerHTML = '<label>Icon</label>';
  const iconRow = document.createElement('div'); iconRow.className = 'icon-row';
  const previewBox = document.createElement('span'); previewBox.className = 'icon-preview';
  const iconInput = document.createElement('input'); iconInput.type = 'text'; iconInput.value = entry.icon || '';
  const pickBtn = document.createElement('button'); pickBtn.className = 'btn'; pickBtn.textContent = 'Pick';
  iconRow.append(previewBox, iconInput, pickBtn);
  iconField.appendChild(iconRow);

  // Brand-variant chooser - shown when an svg: name matches more than one set.
  const variants = document.createElement('div'); variants.className = 'svg-variants';
  iconField.appendChild(variants);

  const picker = document.createElement('div'); picker.className = 'icon-picker';
  BI_ICONS.forEach(n => {
    const cell = document.createElement('span'); cell.className = 'pick'; cell.title = n;
    cell.appendChild(iconEl('bi:' + n));
    cell.addEventListener('click', () => { iconInput.value = 'bi:' + n; onIconChange(); picker.classList.remove('open'); });
    picker.appendChild(cell);
  });
  iconField.appendChild(picker);

  const iconHint = document.createElement('div'); iconHint.className = 'hint';
  iconHint.innerHTML = 'Use <code>bi:name</code> for <a href="https://icons.getbootstrap.com" target="_blank" rel="noopener noreferrer">Bootstrap Icons</a> or <code>svg:name</code> for <a href="https://simpleicons.org" target="_blank" rel="noopener noreferrer">brand icons</a>. Curated icons are built in; <b>any other name is fetched once from a CDN on save</b> and then embedded.';
  iconField.appendChild(iconHint);
  body.appendChild(iconField);

  function updatePreview(): void {
    previewBox.innerHTML = '';
    previewBox.appendChild(iconEl(iconInput.value));
  }

  // Bare svg: name (no explicit set) -> eligible for the multi-set chooser.
  function svgBareName(v: string): string | null {
    v = v.trim();
    if (!v.startsWith('svg:')) return null;
    const ref = v.slice(4);
    return ref && !ref.includes('/') ? ref : null;
  }
  function selectVariant(set: string, name: string): void {
    iconInput.value = `svg:${set}/${name}`;
    updatePreview();
    ([...variants.children] as HTMLElement[]).forEach(c => c.classList.toggle('sel', c.dataset.set === set));
  }
  function renderVariants(name: string, sets: string[]): void {
    variants.innerHTML = '';
    if (sets.length < 2) return; // only offer a choice when more than one set matches
    sets.forEach(set => {
      const v = document.createElement('div'); v.className = 'svg-variant'; v.dataset.set = set; v.title = set;
      v.append(iconEl(`svg:${set}/${name}`), Object.assign(document.createElement('small'), { textContent: set }));
      v.addEventListener('click', () => selectVariant(set, name));
      variants.appendChild(v);
    });
  }
  let pollTimer: ReturnType<typeof setTimeout> | undefined, pollToken = 0;
  function onIconChange(): void {
    updatePreview();
    clearTimeout(pollTimer);
    const name = svgBareName(iconInput.value);
    if (!name) { variants.innerHTML = ''; return; }
    const token = ++pollToken;
    pollTimer = setTimeout(async () => {
      const sets = await findBrandSets(name);
      if (token === pollToken) renderVariants(name, sets);
    }, 400);
  }
  iconInput.addEventListener('input', onIconChange);
  pickBtn.addEventListener('click', () => picker.classList.toggle('open'));

  // Health-check checkbox.
  const checkField = document.createElement('div'); checkField.className = 'field';
  const cr = document.createElement('label'); cr.className = 'check-row';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!entry.check;
  const crText = document.createElement('span'); crText.textContent = 'Show health dot (periodic probe)';
  cr.append(cb, crText);
  checkField.appendChild(cr);
  body.appendChild(checkField);

  // Optional probe-target override: check a dedicated endpoint instead of the
  // first link. Scheme handling matches the link fields (https:// hidden, http://
  // kept visible, bare host -> https).
  const checkUrlField = document.createElement('div'); checkUrlField.className = 'field';
  checkUrlField.innerHTML = '<label>Health-check URL (optional)</label>';
  const checkUrlInput = document.createElement('input'); checkUrlInput.type = 'text';
  checkUrlInput.placeholder = 'defaults to the first link';
  checkUrlInput.value = (entry.checkUrl || '').replace(/^https:\/\//i, '');
  checkUrlInput.dataset.orig = entry.checkUrl || '';
  checkUrlField.appendChild(checkUrlInput);
  const checkUrlHint = document.createElement('div'); checkUrlHint.className = 'hint';
  checkUrlHint.textContent = 'Probe a dedicated endpoint (e.g. a /health path) instead of the first link - for services that block the check (CORS/CORP) or sit behind a login. The tile still opens the first link.';
  checkUrlField.appendChild(checkUrlHint);
  body.appendChild(checkUrlField);
  // Only relevant when the health dot is on.
  const syncCheckUrlVis = () => { checkUrlField.style.display = cb.checked ? '' : 'none'; };
  syncCheckUrlVis();
  cb.addEventListener('change', syncCheckUrlVis);

  // Growable link list (fixed-height scroll -> modal never resizes).
  const linksField = document.createElement('div'); linksField.className = 'field';
  linksField.innerHTML = '<label>Links - first is the default click target</label>';
  const list = document.createElement('div'); list.className = 'link-list';
  linksField.appendChild(list);

  function addLinkRow(link?: Link): void {
    link = link || { label: '', url: '' };
    const row = document.createElement('div'); row.className = 'link-row';
    const h = gripSpan(); h.classList.add('drag-handle');
    const lbl = document.createElement('input'); lbl.type = 'text'; lbl.placeholder = 'Label'; lbl.className = 'lbl'; lbl.value = link.label || '';
    const url = document.createElement('input'); url.type = 'text'; url.placeholder = 'service.example.com'; url.className = 'url';
    url.value = (link.url || '').replace(/^https:\/\//i, ''); // hide only the default scheme; http:// stays visible
    url.dataset.orig = link.url || '';                        // remember scheme for unchanged saves
    const rm = document.createElement('span'); rm.className = 'rm'; rm.title = 'Remove'; rm.appendChild(iconEl('bi:x-lg'));
    rm.addEventListener('click', () => row.remove());
    row.append(h, lbl, url, rm);
    h.addEventListener('pointerdown', (e) => startDrag(e, row, {
      resolve: resolveY,
      getZones: () => [{ container: list, items: [...list.querySelectorAll<HTMLElement>(':scope > .link-row')] }],
      // Drop: move the row into the placeholder's slot, drop the placeholder,
      // and clear the fixed-position drag styling startDrag applied. (Entries/
      // groups get this cleanup for free via rerender(); the link list has none.)
      onCommit: (_item, placeholder) => {
        list.insertBefore(row, placeholder);
        placeholder.remove();
        row.classList.remove('dragging');
        row.removeAttribute('style');
      }
    }));
    list.appendChild(row);
  }
  (entry.links || []).forEach(addLinkRow);

  const addLink = document.createElement('button'); addLink.className = 'btn'; addLink.textContent = '+ Add link';
  addLink.style.marginTop = '8px';
  addLink.addEventListener('click', () => addLinkRow());
  linksField.appendChild(addLink);
  const linkHint = document.createElement('div'); linkHint.className = 'hint';
  linkHint.textContent = 'No scheme needed - https:// is assumed. Type http:// for plain-HTTP services.';
  linksField.appendChild(linkHint);
  body.appendChild(linksField);

  // Footer.
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => closeModal(backdrop));
  const save = document.createElement('button'); save.className = 'btn primary'; save.textContent = 'Save';
  save.addEventListener('click', async () => {
    const iconVal = iconInput.value.trim();
    save.disabled = true; save.textContent = 'Saving...';
    try { await embedIcon(iconVal); }
    catch (err) { alert('Could not load icon: ' + errMsg(err)); save.disabled = false; save.textContent = 'Save'; return; }
    entry.name  = name.input.value.trim() || 'Untitled';
    entry.icon  = iconVal || 'bi:box-fill';
    entry.check = cb.checked;
    const cu = resolveLinkUrl(checkUrlInput);
    if (cu) entry.checkUrl = cu; else delete entry.checkUrl;
    entry.links = [...list.querySelectorAll<HTMLElement>('.link-row')]
      .map(r => ({ label: r.querySelector<HTMLInputElement>('.lbl')!.value.trim(), url: resolveLinkUrl(r.querySelector<HTMLInputElement>('.url')!) }))
      .filter(l => l.url);
    pruneIconCache();
    saved = true;
    persist();
    rerender();
    closeModal(backdrop);
  });
  foot.append(cancel, save);

  onIconChange();
}
