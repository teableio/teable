import { readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { renderHeicAsPng } from './heic-thumbnail';

describe('renderHeicAsPng', () => {
  it('decodes a HEIC file into a PNG buffer with matching dimensions', async () => {
    const heic = readFileSync(join(__dirname, '__fixtures__', 'sample.heic'));

    const { buffer, width, height } = await renderHeicAsPng(heic);

    expect(width).toBe(128);
    expect(height).toBe(80);
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(80);
  });

  it('rejects non-HEIC input', async () => {
    await expect(renderHeicAsPng(Buffer.from('not a heic file'))).rejects.toThrow();
  });

  it('rejects a pixel bomb without decoding it', async () => {
    const bomb = Buffer.from(readFileSync(join(__dirname, '__fixtures__', 'sample.heic')));
    // ispe box: fourcc, u32 version/flags, u32 width, u32 height. Declare
    // 30000x30000 (3.6GB of RGBA if decoded) — large enough to be dangerous,
    // small enough to pass libheif's own 2^30-pixel parse-time ceiling, so it
    // must be our guard that rejects it.
    const ispe = bomb.indexOf('ispe');
    expect(ispe).toBeGreaterThan(0);
    bomb.writeUInt32BE(30000, ispe + 8);
    bomb.writeUInt32BE(30000, ispe + 12);

    await expect(renderHeicAsPng(bomb)).rejects.toThrow(/pixel limit/);
  });
});
