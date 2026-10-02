import { resolveThumbnailMimetype } from './utils';

describe('resolveThumbnailMimetype', () => {
  it('keeps raster image formats', () => {
    expect(resolveThumbnailMimetype('image/jpeg')).toBe('image/jpeg');
    expect(resolveThumbnailMimetype('image/webp')).toBe('image/webp');
  });

  it('serves SVG and HEIC thumbnails as PNG', () => {
    expect(resolveThumbnailMimetype('image/svg+xml')).toBe('image/png');
    expect(resolveThumbnailMimetype('image/heic')).toBe('image/png');
  });

  it('serves non-image thumbnails as PNG', () => {
    expect(resolveThumbnailMimetype('application/pdf')).toBe('image/png');
  });
});
