/* Modal scaffold shared by every dialog, plus the two small ones: accessibility
   and help. The entry editor and global options live in entry-modal.ts and
   options-modal.ts. */

import { CONFIG, persist, flushGist, rerender } from './state';
import { isTouch, getTouchMode, setTouchMode, type TouchMode } from './touch';
import { errMsg } from './util';
import { APP_VERSION, IS_WEB } from './build';
import { UPDATES_SUPPORTED, checkForUpdate, getAutoCheck, setAutoCheck } from './update';

const REPO_URL = 'https://github.com/BrainInBlack/CRTL';

/* ---- scaffold ---- */

/**
 * Modal scaffold. A click on the backdrop does *not* dismiss by default: these
 * dialogs hold unsaved edits (entry, options) or a decision that has to be
 * made, and losing them to a stray tap next to the box is the worst outcome
 * available. `dismissOnBackdrop` opts a read-only dialog (help) back in.
 */
export function buildModal(title: string, { dismissOnBackdrop = false } = {}): { backdrop: HTMLElement; body: HTMLElement; foot: HTMLElement } {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div'); modal.className = 'modal';
  const head = document.createElement('div'); head.className = 'modal-header'; head.textContent = title;
  const body = document.createElement('div'); body.className = 'modal-body';
  const foot = document.createElement('div'); foot.className = 'modal-footer';
  modal.append(head, body, foot);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  if (dismissOnBackdrop) {
    backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) closeModal(backdrop); });
  }
  requestAnimationFrame(() => backdrop.classList.add('open'));
  return { backdrop, body, foot };
}

export function closeModal(backdrop: HTMLElement): void {
  if (backdrop._onClose) backdrop._onClose();
  backdrop.remove();
}

export function fieldText(label: string, value?: string): { field: HTMLElement; input: HTMLInputElement } {
  const field = document.createElement('div'); field.className = 'field';
  const l = document.createElement('label'); l.textContent = label;
  const input = document.createElement('input'); input.type = 'text'; input.value = value || '';
  field.append(l, input);
  return { field, input };
}

/* ---- accessibility ---- */

/** A small home for accessibility options (opened from the button next to Help).
   Toggles apply immediately - persist + push + repaint - so there's no Save. */
export function openA11yModal(): void {
  const { backdrop, body, foot } = buildModal('Accessibility');

  const intro = document.createElement('div'); intro.className = 'hint'; intro.style.marginBottom = '14px';
  intro.textContent = 'Options to make CRTL easier to read and use. Changes apply immediately.';
  body.appendChild(intro);

  // Colour-blind friendly health dots.
  const cbField = document.createElement('div'); cbField.className = 'field';
  const cbLabel = document.createElement('label'); cbLabel.textContent = 'Health dots';
  const cbRow = document.createElement('label'); cbRow.className = 'check-row';
  const cbInput = document.createElement('input'); cbInput.type = 'checkbox'; cbInput.checked = !!CONFIG.colorBlind;
  const cbText = document.createElement('span'); cbText.textContent = 'Colour-blind friendly (check / cross marks)';
  cbRow.append(cbInput, cbText);
  const cbHint = document.createElement('div'); cbHint.className = 'hint';
  cbHint.textContent = 'Resolved health dots show a check (up) or cross (down) glyph, not colour alone.';
  cbField.append(cbLabel, cbRow, cbHint);
  body.appendChild(cbField);

  cbInput.addEventListener('change', () => {
    CONFIG.colorBlind = cbInput.checked;
    persist();      // a real edit: bump version + mark the gist dirty
    flushGist();    // options live outside edit mode - push now
    rerender();     // re-mount the dots in the new mode
  });

  // Touch mode. Unlike everything else in here this is device-local (see
  // touch.ts): CONFIG travels between machines via the gist, and a phone's
  // input setting has no business following the user to their desktop.
  const tmField = document.createElement('div'); tmField.className = 'field';
  const tmLabel = document.createElement('label'); tmLabel.textContent = 'Touch mode';
  const tmSelect = document.createElement('select');
  ([['auto', 'Auto - follow this device'], ['on', 'Always on'], ['off', 'Always off']] as const)
    .forEach(([value, text]) => {
      const o = document.createElement('option'); o.value = value; o.textContent = text;
      tmSelect.appendChild(o);
    });
  tmSelect.value = getTouchMode();
  tmSelect.addEventListener('change', () => setTouchMode(tmSelect.value as TouchMode));
  const tmHint = document.createElement('div'); tmHint.className = 'hint';
  tmHint.textContent = 'Bigger targets, drag grips in edit mode, and edit / delete in a menu instead of hover-only icons. Auto follows the pointer this device reports. Kept on this device - never synced.';
  tmField.append(tmLabel, tmSelect, tmHint);
  body.appendChild(tmField);

  const close = document.createElement('button'); close.className = 'btn primary'; close.textContent = 'Close';
  close.addEventListener('click', () => closeModal(backdrop));
  foot.append(close);
}

/* ---- help ---- */

// Local build only: the downloaded file never updates itself, so Help offers a
// manual check plus the opt-in startup check (see update.ts). Built with DOM
// calls - the status line carries text from a network error.
function buildUpdateSection(): HTMLElement {
  const sec = document.createElement('div'); sec.className = 'help-section';
  const h = document.createElement('h4'); h.textContent = 'Updates';
  const p = document.createElement('p');
  p.textContent = 'This file does not update itself. Checking asks GitHub (api.github.com) for the latest release.';

  const row = document.createElement('div'); row.className = 'update-row';
  const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = 'Check now';
  const status = document.createElement('span'); status.className = 'update-status';
  row.append(btn, status);

  btn.addEventListener('click', async () => {
    btn.disabled = true; status.textContent = 'Checking...';
    try {
      const rel = await checkForUpdate();
      status.textContent = '';
      if (rel) {
        const a = document.createElement('a');
        a.href = rel.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = `Download v${rel.version}`;
        status.append('New version available - ', a);
      } else {
        status.textContent = 'You have the latest version.';
      }
    } catch (err) {
      status.textContent = 'Check failed: ' + errMsg(err);
    } finally {
      btn.disabled = false;
    }
  });

  const auto = document.createElement('label'); auto.className = 'check-row';
  const autoInput = document.createElement('input'); autoInput.type = 'checkbox'; autoInput.checked = getAutoCheck();
  const autoText = document.createElement('span'); autoText.textContent = 'Check on startup (at most once a day, this device only)';
  auto.append(autoInput, autoText);
  autoInput.addEventListener('change', () => setAutoCheck(autoInput.checked));

  sec.append(h, p, row, auto);
  return sec;
}

export function openHelpModal(): void {
  const { body } = buildModal('Help', { dismissOnBackdrop: true }); // read-only, nothing to lose

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

  // The gestures differ by input, so the instructions do too (see touch.ts).
  const Tap = isTouch ? 'Tap' : 'Click';
  const tap = Tap.toLowerCase();
  const reorder = isTouch
    ? 'Drag a row or group header by its <b>grip</b> to reorder; drop an entry in another group to move it.'
    : 'Drag group headers or entries to reorder; drop an entry in another group to move it.';
  const rowActions = isTouch
    ? `<b>Tap</b> an entry for <b>edit</b> / <b>delete</b>`
    : `<b>Hover</b> an entry to <b>edit</b> or <b>delete</b> it`;

  body.innerHTML = `
    <div class="help-section">
      <h4>Using the dashboard</h4>
      <p><b>${Tap}</b> an entry to open its main link.</p>
      <p><b>Long-press</b> (or tap the dots) to reveal all of an entry's links.</p>
      <p>The <b>gear</b> -> <b>Theme</b> switches colour themes (Phosphor, Paper); the sun / moon button (bottom-right) flips light and dark.</p>
      <p>The <b>Home / Away</b> pill (top-right) auto-detects your location; ${tap} to cycle <b>lock -> switch -> auto</b>. Away shows public links first and dims home-only entries. Dots: green up, amber down - or check / cross marks with the colour-blind option in the <b>Accessibility</b> menu (bottom-left).</p>
    </div>
    ${webNote}
    <div class="help-section">
      <h4>Editing</h4>
      <p>Open the <b>gear</b> (bottom-right) -> <b>Edit mode</b>.</p>
      <p>${reorder}</p>
      <p>${rowActions}, ${tap} a group title to rename, and use <b>+</b> to add entries or groups.</p>
      <p>The arrows in a group's header make it <b>double width</b> or <b>double height</b> - one at a time, on screens wide enough for two columns.</p>
      <p>Icons: <code>bi:name</code> (<a href="https://icons.getbootstrap.com" target="_blank" rel="noopener noreferrer">Bootstrap</a>) or <code>svg:name</code> (<a href="https://simpleicons.org" target="_blank" rel="noopener noreferrer">brand</a>); uncurated ones fetch once from a CDN.</p>
    </div>
    <div class="help-section">
      <h4>Sync &amp; backup</h4>
      <p>Config saves in this browser. <b>Global options</b> enables encrypted GitHub-gist sync across machines - AES-encrypted, but your token + key sit in local storage in plaintext.</p>
      <p>No GitHub? <b>Encrypted backup</b> (also in Global options) exports the config as a passphrase-protected file you can import on another machine.</p>
    </div>
    <div class="help-about">CRTL v${APP_VERSION} <span>(${IS_WEB ? 'web' : 'local'} build)</span></div>
  `;
  if (UPDATES_SUPPORTED) body.querySelector('.help-about')!.before(buildUpdateSection());
  // No Close button: help is the one dialog you can dismiss by clicking beside
  // it (or with Escape), so the footer would be a bar with one redundant
  // control. An empty .modal-footer hides itself.
}
