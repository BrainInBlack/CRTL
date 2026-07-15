/* Encrypted local backup: export/import the config as a passphrase-protected
   file - the offline sibling of gist sync. The AES-GCM key is derived from the
   passphrase (PBKDF2-SHA256, per-export random salt), so nothing but the file
   and the passphrase move between machines. The payload mirrors the gist
   payload: config without the icon cache (icons re-embed from their bi:/svg:
   ids on import) and never any sync credentials. */

import { encryptStr, decryptStr, b64encode, b64decode } from './sync';
import type { Config } from './types';

const FORMAT = 'crtl-backup';
const ENVELOPE_VERSION = 1;
/** PBKDF2-SHA256 cost for new exports (OWASP ballpark). Stored per file, so it
   can be raised later while old backups stay importable. */
export const DEFAULT_ITERATIONS = 600_000;
// Ceiling for imported files: a hostile envelope with a huge iteration count
// would otherwise stall the tab inside deriveBits.
const MAX_ITERATIONS = 10_000_000;
/** Size ceiling for imported files. A real backup is a few KB; anything huge is
   hostile or wrong and would stall the tab in text()/JSON.parse/atob. */
export const MAX_BACKUP_BYTES = 10_000_000;

/** The backup file: a versioned envelope around base64(iv || AES-GCM ct). */
interface Envelope {
  format: typeof FORMAT;
  version: number;
  kdf: { algo: 'PBKDF2-SHA256'; iterations: number; salt: string };
  payload: string;
}

/** Web Crypto needs a secure context - file:// and https:// qualify, a page
   served over plain http:// does not (same limitation as gist sync). */
export const backupCryptoAvailable = (): boolean => !!globalThis.crypto?.subtle;

/** Passphrase -> base64 raw AES key, so encryptStr/decryptStr (sync.ts) can be
   reused as-is. Exported for tests. */
export async function deriveKeyB64(passphrase: string, saltB64: string, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64decode(saltB64), iterations },
    material, 256);
  return b64encode(bits);
}

/** Encrypt `config` (minus the icon cache) into an envelope-JSON string.
   `iterations` is overridable for tests - the real PBKDF2 cost is slow on
   purpose. */
export async function exportBackup(config: Config, passphrase: string,
  { iterations = DEFAULT_ITERATIONS }: { iterations?: number } = {}): Promise<string> {
  const salt = b64encode(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKeyB64(passphrase, salt, iterations);
  const { iconCache, ...payload } = config;
  const env: Envelope = {
    format: FORMAT,
    version: ENVELOPE_VERSION,
    kdf: { algo: 'PBKDF2-SHA256', iterations, salt },
    payload: await encryptStr(JSON.stringify(payload), key)
  };
  return JSON.stringify(env, null, 2);
}

/** Decrypt and parse an envelope-JSON string. Throws a user-facing message on
   a malformed envelope or a wrong passphrase. The result is untrusted input -
   callers hand it to applyConfig(), which normalizes it like a gist payload. */
export async function importBackup(text: string, passphrase: string): Promise<Config> {
  if (text.length > MAX_BACKUP_BYTES) throw new Error('Not a CRTL backup file');
  let env: Partial<Envelope>;
  try { env = JSON.parse(text) as Partial<Envelope>; }
  catch { throw new Error('Not a CRTL backup file'); }
  if (!env || env.format !== FORMAT) throw new Error('Not a CRTL backup file');
  if (env.version !== ENVELOPE_VERSION) throw new Error('Unsupported backup version (' + env.version + ')');
  const k = env.kdf;
  if (!k || k.algo !== 'PBKDF2-SHA256' || typeof k.salt !== 'string'
    || typeof k.iterations !== 'number' || k.iterations < 1 || k.iterations > MAX_ITERATIONS
    || typeof env.payload !== 'string') throw new Error('Not a CRTL backup file');
  let cfg: Config;
  try {
    const key = await deriveKeyB64(passphrase, k.salt, k.iterations);
    cfg = JSON.parse(await decryptStr(env.payload, key)) as Config;
  } catch {
    // Covers a bad salt, a failed GCM auth, and non-JSON plaintext alike.
    throw new Error('Wrong passphrase or corrupted backup');
  }
  // Export never includes the icon cache; drop a smuggled one so the exclusion
  // holds in both directions (icons rebuild from their ids instead).
  return { ...cfg, iconCache: {} };
}

/** Trigger a browser download of the envelope. */
export function downloadBackup(envelopeJson: string): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(new Blob([envelopeJson], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `crtl-backup-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
