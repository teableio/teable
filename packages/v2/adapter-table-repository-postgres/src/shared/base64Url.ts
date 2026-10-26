/**
 * UTF-8 safe base64url encoding that works in browsers and Node.
 *
 * `Buffer.from(..., 'base64url')` is Node-only and forces a bundler shim; the
 * `btoa`/`atob` pair exists in both runtimes, so the payload is bridged through
 * bytes with a shared encoder/decoder. Chunking keeps `String.fromCharCode` away
 * from the argument-count limit on large payloads.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CHUNK_SIZE = 0x8000;

export const encodeBase64Url = (value: string): string => {
  const bytes = encoder.encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK_SIZE));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

export const decodeBase64Url = (value: string): string => {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return decoder.decode(bytes);
};
