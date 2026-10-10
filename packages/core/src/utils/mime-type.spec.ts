import { isInlineSafeMimetype } from './mime-type';

describe('isInlineSafeMimetype', () => {
  it.each([
    'image/png',
    'IMAGE/JPEG',
    'image/gif',
    'image/webp',
    'image/heic',
    'application/pdf',
    'application/pdf; charset=binary',
    'text/plain',
    'text/plain; charset=utf-8',
    'application/json',
    'video/mp4',
    'audio/mpeg',
  ])('serves %s inline', (mimetype) => {
    expect(isInlineSafeMimetype(mimetype)).toBe(true);
  });

  it.each([
    'text/html',
    'TEXT/HTML',
    'text/html; charset=utf-8',
    'application/xhtml+xml',
    'image/svg+xml',
    'text/xml',
    'application/xml',
    'application/rss+xml',
    'application/mathml+xml',
    'text/javascript',
    'application/javascript',
    'text/xsl',
    'text/csv',
    'text/markdown',
    'application/zip',
    'application/octet-stream',
    // aliases Express expands into a real type
    'html',
    'svg',
    'xhtml',
    // the browser uses the last entry of a list
    'image/png,text/html',
    'application/pdf,text/html',
    'application/pdf+xml',
    '',
  ])('forces a download for %s', (mimetype) => {
    expect(isInlineSafeMimetype(mimetype)).toBe(false);
  });
});
