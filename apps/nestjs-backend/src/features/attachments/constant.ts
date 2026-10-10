export const ATTACHMENT_SM_THUMBNAIL_HEIGHT = 56;
export const ATTACHMENT_LG_THUMBNAIL_HEIGHT = 525;
export const ATTACHMENT_THUMBNAIL_DEFAULT_MIMETYPE = 'image/png';

/**
 * Policy on every local read response. It only takes effect when the object
 * is opened as a document (a tab or frame pointed straight at the url), where
 * it keeps an uploaded file from running scripts or pulling sub-resources on
 * the app origin; plain image/media embeds are unaffected.
 */
export const ATTACHMENT_READ_CSP =
  "default-src 'none'; img-src 'self' data: blob:; media-src 'self'; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
