export const isImage = (mimetype: string) => {
  return mimetype.startsWith('image/');
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
