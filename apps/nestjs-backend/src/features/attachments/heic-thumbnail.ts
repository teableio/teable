import sharp from 'sharp';

// Dimensions come from file metadata (ispe box), so a tiny crafted file can
// declare an arbitrary size and force a width*height*4 output allocation.
// Check the declared size before decoding. 60MP covers the largest real-world
// producer (iPhone HEIF Max, 8064x6048 = 48.8MP).
const MAX_HEIC_PIXELS = 60_000_000;

export async function renderHeicAsPng(
  heicData: Buffer
): Promise<{ buffer: Buffer; width: number; height: number }> {
  // Lazy import: libheif's WASM is instantiated at require time, so only pods
  // that actually process a HEIC file pay the memory cost.
  const { default: decodeHeic } = await import('heic-decode');
  const images = await decodeHeic.all({ buffer: heicData });
  try {
    const [image] = images;
    if (image.width * image.height > MAX_HEIC_PIXELS) {
      throw new Error(
        `HEIC declares ${image.width}x${image.height}, over the ${MAX_HEIC_PIXELS} pixel limit`
      );
    }
    const { width, height, data } = await image.decode();
    const buffer = await sharp(data, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    return { buffer, width, height };
  } finally {
    images.dispose();
  }
}
