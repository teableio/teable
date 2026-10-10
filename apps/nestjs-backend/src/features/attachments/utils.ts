import { isAudio, isHeic, isImage, isInlineSafeMimetype, isSvg, isVideo } from '@teable/core';
import { ATTACHMENT_THUMBNAIL_DEFAULT_MIMETYPE } from './constant';

const PREVIEWABLE_DOCUMENT_MIMETYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'text/plain',
  'application/json',
]);

/**
 * Content-Type a public-bucket object is served with when only its attachment
 * row is known: the stored mimetype for the families a browser previews,
 * a generic download for anything else.
 */
export const getExtensionPreview = (mimetype: string) => {
  const type = mimetype.split(';')[0].trim().toLowerCase();
  if (isImage(type) || isAudio(type) || isVideo(type) || PREVIEWABLE_DOCUMENT_MIMETYPES.has(type)) {
    return mimetype;
  }
  return 'application/octet-stream';
};

/**
 * Html/svg/xml/js uploads opened inline from the app origin run as a
 * same-origin document with the viewer's session — stored XSS. Rewrite the
 * disposition to a download for every type outside the inline-safe list
 * (see isInlineSafeMimetype), and when no type is given at all, no matter
 * what the token or the caller asked for, keeping any file name parameters.
 * Mutates and returns `headers`.
 */
export const forceAttachmentDisposition = <T extends Record<string, unknown>>(headers: T): T => {
  const contentType = headers['Content-Type'];
  if (typeof contentType === 'string' && isInlineSafeMimetype(contentType)) {
    return headers;
  }
  const disposition = headers['Content-Disposition'];
  const current = typeof disposition === 'string' ? disposition.trim() : '';
  if (!/^attachment\b/i.test(current)) {
    (headers as Record<string, unknown>)['Content-Disposition'] = current
      ? current.replace(/^[^;]*/, 'attachment')
      : 'attachment';
  }
  return headers;
};

export const resolveThumbnailMimetype = (mimetype: string) => {
  // Image thumbnails keep the source format (cropImage preserves it), except
  // HEIC (decoded server-side) and SVG (sharp cannot write it), both rendered as PNG.
  return isImage(mimetype) && !isHeic(mimetype) && !isSvg(mimetype)
    ? mimetype
    : ATTACHMENT_THUMBNAIL_DEFAULT_MIMETYPE;
};
