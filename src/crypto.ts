/* AES-GCM primitives shared by gist sync (sync.ts) and the encrypted backup
   (backup.ts). Pure WebCrypto - no app state, no DOM. Payloads are
   base64(iv || ciphertext) with a fresh 12-byte IV per message. */

export const b64encode = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const b64decode = (str: string) => Uint8Array.from(atob(str), c => c.charCodeAt(0));

/** Fresh 256-bit key, base64 (raw) for storage. */
export async function generateKeyB64(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return b64encode(await crypto.subtle.exportKey('raw', key));
}

const importKey = (keyB64: string) =>
  crypto.subtle.importKey('raw', b64decode(keyB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

/** Encrypt -> base64(iv || ciphertext). */
export async function encryptStr(plaintext: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return b64encode(out);
}

/** Decrypt base64(iv || ciphertext) -> string. */
export async function decryptStr(payload: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const bytes = b64decode(payload);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return new TextDecoder().decode(pt);
}
