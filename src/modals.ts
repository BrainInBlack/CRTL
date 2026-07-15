/* Modals: entry editor, global options (probes + encrypted sync), help. */

import { CONFIG, persist, flushGist, rerender, applyConfig, saveLocal, importing, setImporting } from './state';
import { embedIcon, embedAllIcons, iconEl, pruneIconCache, findBrandSets } from './icons';
import { BI_ICONS } from './icon-list';
import {
  getSync, setSync, exportSyncBlob, importSyncBlob,
  generateKeyB64, createGist, importFromGist, getSyncError
} from './sync';
import { exportBackup, importBackup, downloadBackup, backupCryptoAvailable, MAX_BACKUP_BYTES } from './backup';
import { recheckLocation } from './location';
import { startDrag, resolveY } from './dnd';
import { errMsg, safeUrl } from './util';
import { APP_VERSION, IS_WEB } from './build';
import type { Link } from './types';

const REPO_URL = 'https://github.com/BrainInBlack/CRTL';

/* ---- scaffold ---- */

function buildModal(title: string): { backdrop: HTMLElement; body: HTMLElement; foot: HTMLElement } {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div'); modal.className = 'modal';
  const head = document.createElement('div'); head.className = 'modal-header'; head.textContent = title;
  const body = document.createElement('div'); body.className = 'modal-body';
  const foot = document.createElement('div'); foot.className = 'modal-footer';
  modal.append(head, body, foot);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) closeModal(backdrop); });
  requestAnimationFrame(() => backdrop.classList.add('open'));
  return { backdrop, body, foot };
}

export function closeModal(backdrop: HTMLElement): void {
  if (backdrop._onClose) backdrop._onClose();
  backdrop.remove();
}

function fieldText(label: string, value?: string): { field: HTMLElement; input: HTMLInputElement } {
  const field = document.createElement('div'); field.className = 'field';
  const l = document.createElement('label'); l.textContent = label;
  const input = document.createElement('input'); input.type = 'text'; input.value = value || '';
  field.append(l, input);
  return { field, input };
}

// Scheme is optional in a link field: a bare host becomes https://; an explicitly
// typed http://|https:// is kept; an unchanged existing value keeps its original
// scheme, so http-only internal services aren't silently upgraded to https.
function resolveLinkUrl(input: HTMLInputElement): string {
  const raw = input.value.trim();
  if (!raw) return '';
  // safeUrl on every branch: `orig` can carry a pre-existing javascript:/data:
  // value (the "unchanged, keep original scheme" branch would otherwise let it
  // survive an edit), and it hardens the explicit-scheme branch too.
  if (/^https?:\/\//i.test(raw)) return safeUrl(raw);
  const orig = input.dataset.orig || '';
  if (orig && raw === orig.replace(/^https?:\/\//i, '')) return safeUrl(orig);
  return safeUrl('https://' + raw);
}

/* ---- entry editor ---- */

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
  iconHint.innerHTML = 'Use <code>bi:name</code> for <a href="https://icons.getbootstrap.com" target="_blank" rel="noopener noreferrer">Bootstrap Icons</a> or <code>svg:name</code> for <a href="https://superdevpro.com/brands" target="_blank" rel="noopener noreferrer">brand icons</a>. Curated icons are built in; <b>any other name is fetched once from a CDN on save</b> and then embedded.';
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
  cr.append(cb, document.createTextNode(' Show health dot (periodic probe)'));
  checkField.appendChild(cr);
  body.appendChild(checkField);

  // Growable link list (fixed-height scroll -> modal never resizes).
  const linksField = document.createElement('div'); linksField.className = 'field';
  linksField.innerHTML = '<label>Links - first is the default click target</label>';
  const list = document.createElement('div'); list.className = 'link-list';
  linksField.appendChild(list);

  function addLinkRow(link?: Link): void {
    link = link || { label: '', url: '' };
    const row = document.createElement('div'); row.className = 'link-row';
    const h = iconEl('bi:grip-vertical'); h.classList.add('drag-handle');
    const lbl = document.createElement('input'); lbl.type = 'text'; lbl.placeholder = 'Label'; lbl.className = 'lbl'; lbl.value = link.label || '';
    const url = document.createElement('input'); url.type = 'text'; url.placeholder = 'service.example.com'; url.className = 'url';
    url.value = (link.url || '').replace(/^https?:\/\//i, ''); // show without scheme
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

/* ---- global options ---- */

export function openOptionsModal(): void {
  const { backdrop, body, foot } = buildModal('Global options');

  // Home-detection probes.
  const pf = document.createElement('div'); pf.className = 'field';
  pf.innerHTML = '<label>Home-detection probes (one URL per line)</label>';
  const probesTa = document.createElement('textarea'); probesTa.value = (CONFIG.homeProbes || []).join('\n');
  pf.appendChild(probesTa);
  const ph = document.createElement('div'); ph.className = 'hint';
  ph.textContent = 'Endpoints reachable only on your home network. If any responds, you are Home.';
  pf.appendChild(ph);
  body.appendChild(pf);

  // Encrypted local backup - the offline sibling of gist sync.
  const bkSec = document.createElement('div'); bkSec.className = 'field';
  const bkHead = document.createElement('div'); bkHead.className = 'sync-head';
  const bkLabel = document.createElement('label'); bkLabel.textContent = 'Encrypted backup'; bkLabel.style.margin = '0';
  bkHead.appendChild(bkLabel);
  bkSec.appendChild(bkHead);
  const bkStatus = document.createElement('div'); bkStatus.className = 'hint';
  bkStatus.innerHTML = 'Export groups, links, and probes as a passphrase-encrypted file - no GitHub needed. <b>Sync credentials are never included</b>; icons re-embed from their ids on import.';
  bkSec.appendChild(bkStatus);
  body.appendChild(bkSec);

  const passF  = fieldText('Backup passphrase (min. 8 characters)'); passF.input.type = 'password';
  const pass2F = fieldText('Repeat passphrase (export only)'); pass2F.input.type = 'password';
  body.append(passF.field, pass2F.field);

  const bkBtns = document.createElement('div'); bkBtns.style.display = 'flex'; bkBtns.style.gap = '8px'; bkBtns.style.marginBottom = '14px';
  const exportBtn = document.createElement('button'); exportBtn.className = 'btn'; exportBtn.textContent = 'Export file';
  const importFileBtn = document.createElement('button'); importFileBtn.className = 'btn'; importFileBtn.textContent = 'Import file';
  const fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = '.json,application/json'; fileIn.style.display = 'none';
  bkBtns.append(exportBtn, importFileBtn, fileIn);
  body.appendChild(bkBtns);

  if (!backupCryptoAvailable()) {
    exportBtn.disabled = importFileBtn.disabled = true;
    bkStatus.innerHTML = 'Backup needs a secure context (<code>file://</code> or <code>https://</code>) - not available on a page served over plain <code>http://</code>.';
  }

  exportBtn.addEventListener('click', async () => {
    const p = passF.input.value;
    if (p.length < 8) { alert('Enter a passphrase of at least 8 characters first.'); return; }
    if (p !== pass2F.input.value) { alert('The passphrases do not match.'); return; }
    exportBtn.disabled = true; exportBtn.textContent = 'Exporting...';
    try { downloadBackup(await exportBackup(CONFIG, p)); }
    catch (err) { alert('Export failed: ' + errMsg(err)); }
    finally { exportBtn.disabled = false; exportBtn.textContent = 'Export file'; }
  });

  importFileBtn.addEventListener('click', () => {
    if (importing) { alert('A sync import is in progress - try again in a moment.'); return; }
    if (!passF.input.value) { alert('Enter the backup passphrase first.'); return; }
    fileIn.value = ''; // allow re-picking the same file
    fileIn.click();
  });

  fileIn.addEventListener('change', async () => {
    const file = fileIn.files && fileIn.files[0];
    if (!file) return;
    // Re-check the lock: the picker was open for a while, and a gist import or
    // adopt may have taken it since the button-click check. Synchronous from
    // here to setImporting(true), so the check can't go stale.
    if (importing) { alert('A sync import is in progress - try again in a moment.'); return; }
    if (file.size > MAX_BACKUP_BYTES) { alert('Import failed: file is too large to be a CRTL backup.'); return; }
    importFileBtn.disabled = true; importFileBtn.textContent = 'Importing...';
    // Take the same write-lock as a gist import: blocks edit mode, the gist
    // buttons below, and the periodic background pull while CONFIG is replaced.
    setImporting(true);
    try {
      // Decrypt first, confirm second - a wrong passphrase should fail before
      // the user is asked to overwrite anything.
      const next = await importBackup(await file.text(), passF.input.value);
      if (!confirm('Replace the config in this browser with the backup?')) return;
      applyConfig(next);                       // normalizes + keeps the local icon cache
      probesTa.value = (CONFIG.homeProbes || []).join('\n'); // keep the open modal in sync
      await embedAllIcons((done, total) => {
        importFileBtn.textContent = total ? `Icons ${done}/${total}...` : 'Icons...';
      });
      saveLocal();                             // persist freshly fetched icons (no version bump)
      persist();                               // the import is a real edit - bump + mark gist dirty
      rerender();                              // repaint with the now-cached icons
      recheckLocation();                       // probes may have changed
      bkStatus.textContent = 'Backup imported.';
    } catch (err) {
      alert('Import failed: ' + errMsg(err));
    } finally {
      setImporting(false);
      importFileBtn.disabled = false; importFileBtn.textContent = 'Import file';
    }
    flushGist();  // options live outside edit mode - push now (after the lock drops)
  });

  // Encrypted gist sync.
  const cur0 = getSync();
  const sec = document.createElement('div'); sec.className = 'field';
  const syncHead = document.createElement('div'); syncHead.className = 'sync-head';
  const syncLabel = document.createElement('label'); syncLabel.textContent = 'Encrypted gist sync'; syncLabel.style.margin = '0';
  const toggle = document.createElement('span'); toggle.className = 'sync-toggle'; toggle.title = 'Turn sync on or off';
  syncHead.append(syncLabel, toggle);
  sec.appendChild(syncHead);
  const status = document.createElement('div'); status.className = 'hint';
  sec.appendChild(status);
  body.appendChild(sec);

  const patF = fieldText('GitHub token (classic, gist scope)', cur0 ? cur0.pat : ''); patF.input.type = 'password';
  const idF  = fieldText('Gist ID (leave blank to create a new gist)', cur0 ? cur0.gistId : '');
  const keyF = fieldText('Encryption key', cur0 ? cur0.key : '');
  body.append(patF.field, idF.field, keyF.field);

  const genBtn = document.createElement('button'); genBtn.className = 'btn'; genBtn.textContent = 'Generate key';
  genBtn.style.marginBottom = '14px';
  genBtn.addEventListener('click', async () => { keyF.input.value = await generateKeyB64(); });
  body.appendChild(genBtn);

  // Privacy disclaimer.
  const disc = document.createElement('div'); disc.className = 'hint';
  disc.innerHTML = 'Talks to <b>api.github.com</b>; token + key are stored locally in plaintext - only enable on machines you trust.';
  body.appendChild(disc);

  // Cross-machine setup blob.
  const blobF = document.createElement('div'); blobF.className = 'field';
  blobF.innerHTML = '<label>Setup blob</label>';
  const blobTa = document.createElement('textarea'); blobTa.value = exportSyncBlob();
  blobTa.placeholder = 'Paste a blob, then Import';
  blobF.appendChild(blobTa);
  const blobHint = document.createElement('div'); blobHint.className = 'hint';
  blobHint.innerHTML = '(!) Clones sync to another machine - holds your token + key in plaintext, so treat it like a password.';
  blobF.appendChild(blobHint);
  const blobBtns = document.createElement('div'); blobBtns.style.display = 'flex'; blobBtns.style.gap = '8px'; blobBtns.style.marginTop = '8px';
  const copyBtn = document.createElement('button'); copyBtn.className = 'btn'; copyBtn.textContent = 'Copy';
  const importBtn = document.createElement('button'); importBtn.className = 'btn'; importBtn.textContent = 'Import';
  blobBtns.append(copyBtn, importBtn); blobF.appendChild(blobBtns);
  body.appendChild(blobF);

  const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]);
  function refreshSyncUI(): void {
    const cur = getSync();
    const on = !!cur;
    toggle.textContent = on ? 'On' : 'Off';
    toggle.classList.toggle('on', on);
    const err = getSyncError();
    if (!on) {
      status.innerHTML = 'Sync this config (encrypted) to a private GitHub gist.';
    } else {
      status.innerHTML = (err ? `<b class="err">Sync error:</b> ${esc(err)}<br>` : '')
        + 'On - config is AES-encrypted; only your machines hold the key.';
    }
  }
  refreshSyncUI();
  // Reflect background sync failures/recoveries live while the modal is open.
  window.addEventListener('sync-status', refreshSyncUI);
  backdrop._onClose = () => window.removeEventListener('sync-status', refreshSyncUI);

  toggle.addEventListener('click', async () => {
    if (importing) { alert('Another import is already running - try again in a moment.'); return; }
    if (getSync()) { setSync(null); blobTa.value = ''; refreshSyncUI(); return; }
    const pat = patF.input.value.trim(), key = keyF.input.value.trim();
    let id = idF.input.value.trim();
    if (!pat) { alert('Enter a GitHub token first (classic, with the gist scope).'); return; }
    if (!key) { alert('Generate or paste an encryption key first.'); return; }
    toggle.textContent = '...';
    try {
      if (!id) {
        // Brand-new gist seeded from our own config - already authoritative.
        id = await createGist(pat, key); idF.input.value = id;
        setSync({ pat, gistId: id, key });
      } else {
        // Existing gist - import it before any write is permitted.
        setSync({ pat, gistId: id, key });
        await importFromGist();
      }
      blobTa.value = exportSyncBlob();
      refreshSyncUI();
    } catch (err) {
      alert('Could not enable sync: ' + errMsg(err));
      setSync(null);
      refreshSyncUI();
    }
  });

  copyBtn.addEventListener('click', () => {
    blobTa.select();
    // Prefer the async Clipboard API; keep the deprecated execCommand fallback
    // for non-secure-context / older browsers (CRTL often runs over file://).
    if (navigator.clipboard) navigator.clipboard.writeText(blobTa.value).catch(() => {});
    else try { document.execCommand('copy'); } catch {}
  });

  importBtn.addEventListener('click', async () => {
    if (importing) { alert('Another import is already running - try again in a moment.'); return; }
    try {
      const s = importSyncBlob(blobTa.value);
      patF.input.value = s.pat; idF.input.value = s.gistId; keyF.input.value = s.key;
      await importFromGist();   // force-pull the gist + unlock writes on this machine
      refreshSyncUI();
    } catch (err) { alert('Import failed: ' + errMsg(err)); }
  });

  const close = document.createElement('button'); close.className = 'btn'; close.textContent = 'Close';
  close.addEventListener('click', () => closeModal(backdrop));
  const save = document.createElement('button'); save.className = 'btn primary'; save.textContent = 'Save options';
  save.addEventListener('click', () => {
    CONFIG.homeProbes = probesTa.value.split('\n').map(s => s.trim()).filter(Boolean);
    persist();
    flushGist();   // options live outside edit mode - push this change now
    closeModal(backdrop);
    recheckLocation();
  });
  foot.append(close, save);
}

/* ---- help ---- */

export function openHelpModal(): void {
  const { backdrop, foot, body } = buildModal('Help');

  // On the hosted build, browsers can't probe the http LAN over https, so
  // auto-detect is replaced by a manual toggle. Explain it and point at the
  // beacon setup (which restores auto-detect) in the README.
  const webNote = IS_WEB ? `
    <div class="help-section">
      <h4>Home / Away here</h4>
      <p>An <code>https</code> page can't probe your <code>http</code> LAN, so auto-detect is off - the pill is a manual toggle. Tap to switch; dots show only for <code>https</code> services.</p>
      <p>Add an <code>https</code> <a href="${REPO_URL}#home-and-away-on-the-hosted-version" target="_blank" rel="noopener noreferrer">beacon</a> to your Home probes to restore auto-detect.</p>
    </div>
    <div class="help-section">
      <h4>Offline version</h4>
      <p>Want full auto Home / Away and health dots? Open the <b>gear</b> and choose <b>Download offline version</b> - a single self-contained file that runs from <code>file://</code>.</p>
    </div>` : '';

  body.innerHTML = `
    <div class="help-section">
      <h4>Using the dashboard</h4>
      <p><b>Click</b> an entry to open its main link.</p>
      <p><b>Long-press</b> (or tap the dots) to reveal all of an entry's links.</p>
      <p>The <b>Home / Away</b> pill (top-right) auto-detects your location; click to cycle <b>lock -> switch -> auto</b>. Away shows public links first and dims home-only entries. Dots: green up, amber down.</p>
    </div>
    ${webNote}
    <div class="help-section">
      <h4>Editing</h4>
      <p>Open the <b>gear</b> (bottom-right) -> <b>Edit mode</b>.</p>
      <p>Drag group headers or entries to reorder; drop an entry in another group to move it.</p>
      <p>Hover an entry to <b>edit</b> or <b>delete</b> it, click a group title to rename, and use <b>+</b> to add entries or groups.</p>
      <p>Icons: <code>bi:name</code> (<a href="https://icons.getbootstrap.com" target="_blank" rel="noopener noreferrer">Bootstrap</a>) or <code>svg:name</code> (<a href="https://superdevpro.com/brands" target="_blank" rel="noopener noreferrer">brand</a>); uncurated ones fetch once from a CDN.</p>
    </div>
    <div class="help-section">
      <h4>Sync &amp; backup</h4>
      <p>Config saves in this browser. <b>Global options</b> enables encrypted GitHub-gist sync across machines - AES-encrypted, but your token + key sit in local storage in plaintext.</p>
      <p>No GitHub? <b>Encrypted backup</b> (also in Global options) exports the config as a passphrase-protected file you can import on another machine.</p>
    </div>
    <div class="help-about">CRTL v${APP_VERSION} <span>(${IS_WEB ? 'web' : 'local'} build)</span></div>
  `;
  const close = document.createElement('button'); close.className = 'btn primary'; close.textContent = 'Close';
  close.addEventListener('click', () => closeModal(backdrop));
  foot.append(close);
}
