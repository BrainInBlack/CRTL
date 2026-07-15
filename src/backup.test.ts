import { describe, it, expect } from 'vitest';
import { exportBackup, importBackup, deriveKeyB64, MAX_BACKUP_BYTES } from './backup';
import { encryptStr, b64encode } from './sync';
import type { Config } from './types';

const hasSubtle = typeof globalThis.crypto?.subtle?.encrypt === 'function';

// Full PBKDF2 cost is deliberately slow; tests dial it down.
const FAST = { iterations: 1000 };

const config: Config = {
  version: 1752580000000,
  homeProbes: ['http://192.168.1.1/'],
  groups: [{
    group: 'Lab',
    entries: [{ name: 'NAS', icon: 'bi:hdd', check: true, links: [{ label: 'UI', url: 'http://nas.local' }] }]
  }],
  iconCache: { 'bi:hdd': 'data:image/svg+xml;base64,AAAA' }
};

// WebCrypto isn't guaranteed in every test environment; skip cleanly if absent.
(hasSubtle ? describe : describe.skip)('backup envelope', () => {
  it('round-trips the config minus the icon cache', async () => {
    const env = await exportBackup(config, 'correct horse', FAST);
    expect(env).not.toContain('nas.local');           // payload is opaque
    const out = await importBackup(env, 'correct horse');
    const { iconCache, ...expected } = config;
    expect(out).toEqual({ ...expected, iconCache: {} }); // icons re-embed from ids instead
  });

  it('ignores an iconCache smuggled into the payload', async () => {
    // A real export never contains an iconCache - craft an envelope that does.
    const salt = b64encode(crypto.getRandomValues(new Uint8Array(16)));
    const key = await deriveKeyB64('correct horse', salt, FAST.iterations);
    const payload = await encryptStr(JSON.stringify(config), key); // config INCLUDES iconCache
    const env = JSON.stringify({
      format: 'crtl-backup', version: 1,
      kdf: { algo: 'PBKDF2-SHA256', iterations: FAST.iterations, salt }, payload
    });
    const out = await importBackup(env, 'correct horse');
    expect(out.iconCache).toEqual({});                // smuggled cache dropped
  });

  it('rejects an oversized input without parsing it', async () => {
    await expect(importBackup('x'.repeat(MAX_BACKUP_BYTES + 1), 'x')).rejects.toThrow(/not a crtl backup/i);
  });

  it('exposes only envelope fields, never credentials or icons', async () => {
    const parsed = JSON.parse(await exportBackup(config, 'correct horse', FAST));
    expect(Object.keys(parsed).sort()).toEqual(['format', 'kdf', 'payload', 'version']);
    expect(parsed.kdf.iterations).toBe(FAST.iterations);
  });

  it('rejects a wrong passphrase', async () => {
    const env = await exportBackup(config, 'correct horse', FAST);
    await expect(importBackup(env, 'wrong horse')).rejects.toThrow(/passphrase|corrupted/i);
  });

  it('rejects a tampered payload (GCM auth)', async () => {
    const env = JSON.parse(await exportBackup(config, 'correct horse', FAST));
    const p: string = env.payload;
    const i = 10; // inside the iv/ciphertext, away from base64 padding
    env.payload = p.slice(0, i) + (p[i] === 'A' ? 'B' : 'A') + p.slice(i + 1);
    await expect(importBackup(JSON.stringify(env), 'correct horse')).rejects.toThrow(/passphrase|corrupted/i);
  });

  it('rejects non-backup input', async () => {
    await expect(importBackup('not json', 'x')).rejects.toThrow(/not a crtl backup/i);
    await expect(importBackup(JSON.stringify({ format: 'other' }), 'x')).rejects.toThrow(/not a crtl backup/i);
  });

  it('rejects an unsupported envelope version', async () => {
    const env = JSON.parse(await exportBackup(config, 'correct horse', FAST));
    env.version = 999;
    await expect(importBackup(JSON.stringify(env), 'correct horse')).rejects.toThrow(/version/i);
  });

  it('rejects an absurd KDF cost (hostile file)', async () => {
    const env = JSON.parse(await exportBackup(config, 'correct horse', FAST));
    env.kdf.iterations = 1e12;
    await expect(importBackup(JSON.stringify(env), 'correct horse')).rejects.toThrow(/not a crtl backup/i);
  });
});
