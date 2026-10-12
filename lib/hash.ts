const encoder = new TextEncoder();

export async function sha256(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? encoder.encode(input) : input;
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return toHex(new Uint8Array(buf));
}

export function randomHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

function toHex(arr: Uint8Array): string {
  let s = '';
  for (const b of arr) s += b.toString(16).padStart(2, '0');
  return s;
}

export function shortId(id: string): string {
  return id.replace(/^sha256:/, '').slice(0, 12);
}

export function byteLength(s: string): number {
  return encoder.encode(s).length;
}
