export const ATTACHMENT_SM_THUMBNAIL_HEIGHT = 56;
export const ATTACHMENT_LG_THUMBNAIL_HEIGHT = 525;
// Thumbnails are written as WebP under a `.webp` key; keys without it are
// legacy thumbnails stored in their source format (or PNG).
export const ATTACHMENT_THUMBNAIL_MIMETYPE = 'image/webp';
export const ATTACHMENT_THUMBNAIL_EXTENSION = '.webp';
export const ATTACHMENT_THUMBNAIL_WEBP_QUALITY = 80;
// The longest side WebP can encode
export const ATTACHMENT_THUMBNAIL_MAX_SIDE = 16383;
export const ATTACHMENT_LEGACY_THUMBNAIL_MIMETYPE = 'image/png';

/**
 * Policy on every local read response. It only takes effect when the object
 * is opened as a document (a tab or frame pointed straight at the url), where
 * it keeps an uploaded file from running scripts or pulling sub-resources on
 * the app origin; plain image/media embeds are unaffected.
 */
export const ATTACHMENT_READ_CSP =
  "default-src 'none'; img-src 'self' data: blob:; media-src 'self'; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
