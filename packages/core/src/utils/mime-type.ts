export const isImage = (mimetype: string) => {
  return mimetype.startsWith('image/');
};

// HEVC-encoded stills (typically iPhone photos). Browsers cannot render these,
// so thumbnails are decoded server-side into PNG instead of served as-is.
export const heicMimetypes = [
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
];

export const isHeic = (mimetype: string) => {
  return heicMimetypes.includes(mimetype);
};

export const isSvg = (mimetype: string) => {
  return mimetype === 'image/svg+xml';
};

const INLINE_SAFE_DOCUMENT_MIMETYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'text/plain',
  'application/json',
]);

/**
 * Types a browser only ever shows as media, a pdf or plain text when a
 * response is opened directly. Anything else served inline from the app
 * origin may become a live document running with the viewer's session
 * (html, svg and other xml dialects, javascript), so attachment responses of
 * any other type are forced to download. The check fails closed: a stored
 * type is not always canonical — Express expands `html` to text/html, and a
 * comma list makes the browser use its last entry. `<img src>` ignores
 * Content-Disposition, so svg previews still render.
 */
export const isInlineSafeMimetype = (mimetype: string) => {
  if (mimetype.includes(',')) {
    return false;
  }
  const type = mimetype.split(';')[0].trim().toLowerCase();
  if (type.endsWith('+xml') || type.endsWith('/xml')) {
    return false;
  }
  return (
    /^(?:image|audio|video)\/[a-z0-9][\w.+-]*$/.test(type) ||
    INLINE_SAFE_DOCUMENT_MIMETYPES.has(type)
  );
};
export const isVideo = (mimetype: string) => {
  return mimetype.startsWith('video/');
};

export const isAudio = (mimetype: string) => {
  return mimetype.startsWith('audio/');
};

export const isText = (mimetype: string) => {
  return mimetype.startsWith('text/');
};

export const isPdf = (mimetype: string) => {
  return mimetype.startsWith('application/pdf') || mimetype.startsWith('application/x-pdf');
};

export const isWord = (mimetype: string) => {
  return (
    mimetype.startsWith('application/msword') ||
    mimetype.startsWith('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  );
};

export const isExcel = (mimetype: string) => {
  return (
    mimetype.startsWith('application/vnd.ms-excel') ||
    mimetype.startsWith('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ||
    mimetype.startsWith('text/csv') ||
    mimetype.startsWith('application/csv')
  );
};

export const isPpt = (mimetype: string) => {
  return (
    mimetype.startsWith('application/vnd.ms-powerpoint') ||
    mimetype.startsWith('application/vnd.openxmlformats-officedocument.presentationml.presentation')
  );
};

export const isMarkdown = (mimetype: string) => {
  return mimetype.startsWith('text/markdown');
};

export const isPackage = (mimetype: string) => {
  return mimetype.startsWith('application/zip');
};

// Maps a filename extension to its mimetype, for sources that carry only a path
// (e.g. sandbox file listings) and need a mimetype to drive the preview predicates above.
const mimeMap: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  json: 'application/json',
  csv: 'text/csv',
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  ts: 'application/typescript',
  md: 'text/markdown',
};

export function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return mimeMap[ext] ?? 'application/octet-stream';
}
