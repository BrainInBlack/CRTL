import { describe, it, expect, beforeEach } from 'vitest';
import {
  exportSyncBlob, importSyncBlob, setSync, getSync, applyAndEmbed
} from './sync';
import { CONFIG } from './state';
import type { SyncCreds } from './types';

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
