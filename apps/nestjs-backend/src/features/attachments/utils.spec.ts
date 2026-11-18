import { resolveThumbnailMimetype } from './utils';

describe('resolveThumbnailMimetype', () => {
  it('serves WebP thumbnails as WebP whatever the source format', () => {
    expect(resolveThumbnailMimetype('image/png', 'table/x_sm.webp')).toBe('image/webp');
    expect(resolveThumbnailMimetype('image/jpeg', 'table/x_lg.webp')).toBe('image/webp');
    expect(resolveThumbnailMimetype('application/pdf', 'table/x_lg.webp')).toBe('image/webp');
  });

  it('keeps raster image formats for legacy thumbnails', () => {
    expect(resolveThumbnailMimetype('image/jpeg', 'table/x_lg')).toBe('image/jpeg');
    expect(resolveThumbnailMimetype('image/webp', 'table/x_lg')).toBe('image/webp');
  });

  it('serves legacy SVG and HEIC thumbnails as PNG', () => {
    expect(resolveThumbnailMimetype('image/svg+xml', 'table/x_lg')).toBe('image/png');
    expect(resolveThumbnailMimetype('image/heic', 'table/x_lg')).toBe('image/png');
  });

  it('serves legacy non-image thumbnails as PNG', () => {
    expect(resolveThumbnailMimetype('application/pdf', 'table/x_lg')).toBe('image/png');
  });
});
