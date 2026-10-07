/* Global options: home-detection probes, encrypted gist sync, and the
   encrypted local backup. */

import { CONFIG, persist, flushGist, importing, setImporting } from './state';
import {
  getSync, setSync, exportSyncBlob, importSyncBlob,
  createGist, importFromGist, getSyncError, applyAndEmbed
} from './sync';
import { generateKeyB64 } from './crypto';
import { exportBackup, importBackup, downloadBackup, backupCryptoAvailable, MAX_BACKUP_BYTES } from './backup';
import { recheckLocation } from './location';
import { errMsg } from './util';
import { buildModal, closeModal, fieldText } from './modals';

/** Turn a `.field` section into a collapsible accordion: clicking its
   `.sync-head` folds the returned body wrapper in/out. A click on the On/Off
   `.sync-toggle` chip is left to the toggle's own handler (never collapses). */
function makeCollapsible(sec: HTMLElement, head: HTMLElement, collapsed: boolean): HTMLElement {
  sec.classList.add('collapsible');
  head.appendChild(Object.assign(document.createElement('span'), { className: 'collapse-caret' }));
  const cbody = document.createElement('div'); cbody.className = 'collapsible-body';
  sec.appendChild(cbody);
  sec.classList.toggle('collapsed', collapsed);
  head.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.sync-toggle')) return;
    sec.classList.toggle('collapsed');
  });
  return cbody;
}

export function openOptionsModal(): void {
  const { backdrop, body, foot } = buildModal('Global options');

  // Home-detection probes.
  const pf = document.createElement('div'); pf.className = 'field';
  pf.innerHTML = '<label>Home-detection probes (one URL per line)</label>';
  const probesTa = document.createElement('textarea'); probesTa.value = (CONFIG.homeProbes || []).join('\n');
  pf.appendChild(probesTa);
  // Save writes this field back to CONFIG, so it must never go stale: an
  // import (setup blob, backup, background gist pull) can replace the probes
  // while the modal is open, and a stale field would then overwrite them - and
  // push the old list to the gist. Follow each adopt unless the user has
  // edited the field; an import they start themselves always wins.
  let probesEdited = false;
  probesTa.addEventListener('input', () => { probesEdited = true; });
  const syncProbesField = (force = false) => {
    if (probesEdited && !force) return;
    probesTa.value = (CONFIG.homeProbes || []).join('\n');
    probesEdited = false;
  };
  const onAdopted = () => syncProbesField();
  const ph = document.createElement('div'); ph.className = 'hint';
  ph.textContent = 'Endpoints reachable only on your home network. If any responds, you are Home.';
  pf.appendChild(ph);
  body.appendChild(pf);

  // Encrypted gist sync.
  const cur0 = getSync();
  const sec = document.createElement('div'); sec.className = 'field';
  const syncHead = document.createElement('div'); syncHead.className = 'sync-head';
  const syncLabel = document.createElement('label'); syncLabel.textContent = 'Encrypted gist sync'; syncLabel.style.margin = '0';
  const toggle = document.createElement('span'); toggle.className = 'sync-toggle'; toggle.title = 'Turn sync on or off';
  syncHead.append(syncLabel, toggle);
  sec.appendChild(syncHead);
  // Collapsed by default; auto-open when there's a sync error worth surfacing.
  const syncBody = makeCollapsible(sec, syncHead, !getSyncError());
  const status = document.createElement('div'); status.className = 'hint';
  syncBody.appendChild(status);
  body.appendChild(sec);

  const patF = fieldText('GitHub token (classic, gist scope)', cur0 ? cur0.pat : ''); patF.input.type = 'password';
  const idF  = fieldText('Gist ID (leave blank to create a new gist)', cur0 ? cur0.gistId : '');
  const keyF = fieldText('Encryption key', cur0 ? cur0.key : '');
  syncBody.append(patF.field, idF.field, keyF.field);

  const genBtn = document.createElement('button'); genBtn.className = 'btn'; genBtn.textContent = 'Generate key';
  genBtn.style.marginBottom = '14px';
  genBtn.addEventListener('click', async () => { keyF.input.value = await generateKeyB64(); });
  syncBody.appendChild(genBtn);

  // Privacy disclaimer.
  const disc = document.createElement('div'); disc.className = 'hint';
  disc.innerHTML = 'Talks to <b>api.github.com</b>; token + key are stored locally in plaintext - only enable on machines you trust.';
  syncBody.appendChild(disc);

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
  syncBody.appendChild(blobF);

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
  window.addEventListener('config-adopted', onAdopted);
  backdrop._onClose = () => {
    window.removeEventListener('sync-status', refreshSyncUI);
    window.removeEventListener('config-adopted', onAdopted);
  };

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
      syncProbesField(true);    // the gist's probes replace whatever the field held
      refreshSyncUI();
    } catch (err) { alert('Import failed: ' + errMsg(err)); }
  });

  // Encrypted local backup - the offline sibling of gist sync (kept below it).
  const bkSec = document.createElement('div'); bkSec.className = 'field';
  const bkHead = document.createElement('div'); bkHead.className = 'sync-head';
  const bkLabel = document.createElement('label'); bkLabel.textContent = 'Encrypted backup'; bkLabel.style.margin = '0';
  bkHead.appendChild(bkLabel);
  bkSec.appendChild(bkHead);
  const bkBody = makeCollapsible(bkSec, bkHead, true);
  const bkStatus = document.createElement('div'); bkStatus.className = 'hint';
  bkStatus.innerHTML = 'Export groups, links, and probes as a passphrase-encrypted file - no GitHub needed. <b>Sync credentials are never included</b>; icons re-embed from their ids on import.';
  bkBody.appendChild(bkStatus);
  body.appendChild(bkSec);

  const passF  = fieldText('Backup passphrase (min. 8 characters)'); passF.input.type = 'password';
  const pass2F = fieldText('Repeat passphrase (export only)'); pass2F.input.type = 'password';
  bkBody.append(passF.field, pass2F.field);

  const bkBtns = document.createElement('div'); bkBtns.style.display = 'flex'; bkBtns.style.gap = '8px'; bkBtns.style.marginBottom = '14px';
  const exportBtn = document.createElement('button'); exportBtn.className = 'btn'; exportBtn.textContent = 'Export file';
  const importFileBtn = document.createElement('button'); importFileBtn.className = 'btn'; importFileBtn.textContent = 'Import file';
  const fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = '.json,application/json'; fileIn.style.display = 'none';
  bkBtns.append(exportBtn, importFileBtn, fileIn);
  bkBody.appendChild(bkBtns);

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
    // buttons above, and the periodic background pull while CONFIG is replaced.
    setImporting(true);
    try {
      // Decrypt first, confirm second - a wrong passphrase should fail before
      // the user is asked to overwrite anything.
      const next = await importBackup(await file.text(), passF.input.value);
      if (!confirm('Replace the config in this browser with the backup?')) return;
      // We already hold the importing lock, so use the un-locked adopt core.
      // finalize: persist - the import is a real edit (bump version + mark gist dirty).
      await applyAndEmbed(next, {
        onIconProgress: (done, total) => { importFileBtn.textContent = total ? `Icons ${done}/${total}...` : 'Icons...'; },
        finalize: persist
      });
      syncProbesField(true);                   // the backup's probes replace the field
      bkStatus.textContent = 'Backup imported.';
    } catch (err) {
      alert('Import failed: ' + errMsg(err));
    } finally {
      setImporting(false);
      importFileBtn.disabled = false; importFileBtn.textContent = 'Import file';
    }
    flushGist();  // options live outside edit mode - push now (after the lock drops)
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
