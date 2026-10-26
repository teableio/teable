/**
 * UTF-8 byte counting without `Buffer`.
 *
 * `Buffer.byteLength` counts without materializing the encoded copy, so it is
 * preferred where present; everything else (browsers, workers) falls back to a
 * shared `TextEncoder`. A `typeof` check is a capability probe of a global, not
 * an environment switch, and the module stays importable in browser bundles.
 */
const sharedEncoder = new TextEncoder();

const measure: (value: string) => number =
  typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function'
    ? (value) => Buffer.byteLength(value, 'utf8')
    : (value) => sharedEncoder.encode(value).byteLength;

export const utf8ByteLength = (value: string): number => measure(value);
