// Deliberately hand-declared instead of @types/heic-decode: the DT typings
// model `all()` items as bare `{ decode() }` without the width/height fields
// and omit the list's `dispose()` method — both of which the pixel-bomb guard
// in heic-thumbnail.ts depends on.
declare module 'heic-decode' {
  export interface IDecodedHeicImage {
    width: number;
    height: number;
    /** RGBA pixel data, 4 bytes per pixel. */
    data: Uint8ClampedArray;
  }

  /** Image handle exposing declared dimensions without decoding pixel data. */
  export interface IHeicImageHandle {
    width: number;
    height: number;
    decode(): Promise<IDecodedHeicImage>;
  }

  export type IHeicImageList = IHeicImageHandle[] & {
    /** Frees the underlying libheif WASM decoder and image handles. */
    dispose(): void;
  };

  /** Decodes the primary image of a HEIC/HEIF file via WASM libheif. */
  const decode: ((input: { buffer: Buffer | Uint8Array }) => Promise<IDecodedHeicImage>) & {
    all(input: { buffer: Buffer | Uint8Array }): Promise<IHeicImageList>;
  };
  export default decode;
}
