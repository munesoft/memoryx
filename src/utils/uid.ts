// Tiny zero-dep id generator. Cross-platform (Node + browser).

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Get a fast, unbiased random byte source for the host. */
function getRandomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  // Browser / modern Node
  const g: any = typeof globalThis !== 'undefined' ? globalThis : {};
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    g.crypto.getRandomValues(buf);
    return buf;
  }
  // Fallback: weak but never reached on supported runtimes
  for (let i = 0; i < n; i++) buf[i] = (Math.random() * 256) | 0;
  return buf;
}

/**
 * Generate a short, time-prefixed, collision-resistant id.
 * Format: `<base36 timestamp>-<10 random chars>`.
 */
export function uid(): string {
  const t = Date.now().toString(36);
  const bytes = getRandomBytes(10);
  let r = '';
  for (let i = 0; i < bytes.length; i++) {
    r += ALPHABET[bytes[i] % 62];
  }
  return `${t}-${r}`;
}
