import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptStr, decryptStr, generateKeyB64,
  exportSyncBlob, importSyncBlob, setSync, getSync, applyAndEmbed
} from './sync';
import { CONFIG } from './state';
import type { SyncCreds } from './types';

const hasSubtle = typeof globalThis.crypto?.subtle?.encrypt === 'function';

// WebCrypto isn't guaranteed in every test environment; skip cleanly if absent.
(hasSubtle ? describe : describe.skip)('AES-GCM round-trip', () => {
  it('decrypts exactly what it encrypted', async () => {
    const key = await generateKeyB64();
    const msg = JSON.stringify({ hello: 'world', n: 42 });
    const ct = await encryptStr(msg, key);
    expect(ct).not.toContain('hello');            // ciphertext is opaque
    expect(await decryptStr(ct, key)).toBe(msg);
  });

  it('fails to decrypt under a different key', async () => {
    const [k1, k2] = [await generateKeyB64(), await generateKeyB64()];
    const ct = await encryptStr('secret', k1);
    await expect(decryptStr(ct, k2)).rejects.toBeTruthy();
  });
});

describe('sync blob', () => {
  beforeEach(() => { setSync(null); });

  it('round-trips credentials through base64', () => {
    const creds: SyncCreds = { pat: 'ghp_example', gistId: 'abc123', key: 'k3y' };
    setSync(creds);
    const blob = exportSyncBlob();
    setSync(null);
    expect(importSyncBlob(blob)).toEqual(creds);  // parsed back
    expect(getSync()).toEqual(creds);             // and stored
  });

  it('rejects a blob missing required fields', () => {
    const bad = btoa(JSON.stringify({ pat: 'only-pat' }));
    expect(() => importSyncBlob(bad)).toThrow(/missing/i);
  });
});

describe('applyAndEmbed', () => {
  // Every adopt path (gist import, background pull, backup import) runs through
  // here; the options modal and the Home/Away re-detect follow this event, so a
  // stale probes field can't later overwrite adopted probes on Save.
  it('adopts the config and announces it with config-adopted', async () => {
    if (!document.getElementById('container')) {
      document.body.insertAdjacentHTML('beforeend', '<div id="container"></div>');
    }
    let fired = 0;
    const onAdopted = () => { fired++; };
    window.addEventListener('config-adopted', onAdopted);
    try {
      await applyAndEmbed({
        version: 1, homeProbes: ['https://beacon.example'], groups: [], iconCache: {}, colorBlind: false
      });
    } finally {
      window.removeEventListener('config-adopted', onAdopted);
    }
    expect(CONFIG.homeProbes).toEqual(['https://beacon.example']);
    expect(fired).toBe(1);
  });
});
