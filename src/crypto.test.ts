import { describe, it, expect } from 'vitest';
import { encryptStr, decryptStr, generateKeyB64 } from './crypto';

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
