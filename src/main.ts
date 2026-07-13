/* Entry point: styles + fonts, chrome wiring, startup. */

import './styles.css';
import '@fontsource/orbitron/latin-400.css';
import '@fontsource/orbitron/latin-700.css';

import { currentState, manualOverride, editMode, openWrap, saveLocal, rerender } from './state';
import { biUri, embedAllIcons } from './icons';
import { IS_WEB } from './build';
import { closeSlideout, runServiceProbes } from './render';
import { setEditMode } from './edit';
import { openOptionsModal, openHelpModal, closeModal } from './modals';
import { setState, recheckLocation } from './location';
import { probeHome, canAutoDetect } from './probes';
import { syncFromGist, importFromGist, isSyncReady, getSync, getSyncError } from './sync';

const SERVICE_REFRESH_MS = 60000; // re-probe + re-detect + re-pull interval

// Fill the static chrome glyphs (gear, help, sliders) from the bundled set.
document.querySelectorAll<HTMLElement>('[data-bi]').forEach(el =>
	el.style.setProperty('--icon', `url("${biUri(el.dataset.bi!)}")`));

/* ---- gear menu ---- */

const gear     = document.getElementById('gear')!;
const gearMenu = document.getElementById('gear-menu')!;

gear.addEventListener('click', (e) => { e.stopPropagation(); gearMenu.classList.toggle('open'); });
document.getElementById('toggle-edit')!.addEventListener('click', () => setEditMode(!editMode));
document.getElementById('open-options')!.addEventListener('click', () => { gearMenu.classList.remove('open'); openOptionsModal(); });
document.getElementById('help')!.addEventListener('click', openHelpModal);

// Hosted build only: offer a download of the offline single-file version, which
// is deployed alongside the app at download/CRTL.html (see vite.config.ts).
if (IS_WEB) {
	const dl = document.createElement('div');
	dl.className = 'gear-item';
	dl.id = 'download-offline';
	const label = document.createElement('span'); label.textContent = 'Download offline version';
	const icon = document.createElement('span'); icon.className = 'svgicon';
	icon.style.setProperty('--icon', `url("${biUri('download')}")`);
	dl.append(label, icon);
	dl.addEventListener('click', () => { gearMenu.classList.remove('open'); downloadOfflineCopy(); });
	gearMenu.appendChild(dl);
}

// Fetch the single-file build and trigger a save (via a blob URL, so the browser
// downloads it instead of navigating to and rendering the HTML).
async function downloadOfflineCopy(): Promise<void> {
	try {
		const res = await fetch('download/CRTL.html');
		if (!res.ok) throw new Error(String(res.status));
		const url = URL.createObjectURL(await res.blob());
		const a = document.createElement('a');
		a.href = url; a.download = 'CRTL.html';
		document.body.appendChild(a); a.click(); a.remove();
		URL.revokeObjectURL(url);
	} catch {
		alert('Could not download the offline version. Please try again.');
	}
}

/* ---- dark mode ----
   Device-local (not synced): light unless explicitly toggled to dark. The class
   lives on <html> and is pre-applied by an inline head script before first
   paint (see index.html); this only keeps it and the button in sync. */
const THEME_KEY  = 'crtl-theme';
const darkToggle = document.getElementById('toggle-dark')!;

function applyTheme(dark: boolean): void {
	document.documentElement.classList.toggle('dark', dark);
	darkToggle.title = dark ? 'Light mode' : 'Dark mode';
	darkToggle.querySelector<HTMLElement>('.svgicon')!
		.style.setProperty('--icon', `url("${biUri(dark ? 'sun-fill' : 'moon-fill')}")`);
}
applyTheme(document.documentElement.classList.contains('dark'));

darkToggle.addEventListener('click', () => {
	const dark = !document.documentElement.classList.contains('dark');
	try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch {}
	applyTheme(dark);
});

// Tint the gear when sync is failing (errors are otherwise easy to miss).
function refreshSyncIndicator(): void {
	const err = getSync() ? getSyncError() : null;
	gear.classList.toggle('sync-error', !!err);
	gear.title = err ? 'Sync error: ' + err : 'Settings';
}
window.addEventListener('sync-status', refreshSyncIndicator);

/* ---- global dismissal: outside-click + Escape ---- */

document.addEventListener('click', (e) => {
	if (!gear.contains(e.target as Node) && !gearMenu.contains(e.target as Node)) gearMenu.classList.remove('open');
	if (openWrap && !openWrap.contains(e.target as Node)) closeSlideout();
});
document.addEventListener('keydown', (e) => {
	if (e.key !== 'Escape') return;
	const m = document.querySelector<HTMLElement>('.modal-backdrop.open');
	if (m) closeModal(m);
	gearMenu.classList.remove('open');
	closeSlideout();
});

/* ---- startup ---- */

// Render with the last-known state, then probe and switch if detection disagrees.
setState(currentState);
recheckLocation();

// First run on a machine with sync configured: force-import the gist (with a
// progress bar, editing locked) before allowing any write. Otherwise just pull.
function pullGist({ silent = false }: { silent?: boolean } = {}): void {
	if (getSync() && !isSyncReady()) importFromGist({ silent }).catch(() => {});
	else syncFromGist();
}
pullGist();

// Backfill the icon cache: download any referenced icon we don't have locally
// yet and persist it, so it renders offline and is never re-fetched. Icons are
// kept out of the gist (to keep it small), so each machine embeds what it needs
// exactly once - after this, an icon is only ever fetched if it's truly missing.
embedAllIcons().then(added => { if (added) { saveLocal(); rerender(); } }).catch(() => {});

// Periodic: re-probe service dots, re-pull the gist, re-detect Home/Away.
// Import retries here are silent (no overlay) so a flaky network doesn't flash.
setInterval(() => {
	runServiceProbes();
	pullGist({ silent: true });
	if (!manualOverride && canAutoDetect()) probeHome().then(d => { if (d !== currentState) setState(d); });
}, SERVICE_REFRESH_MS);
