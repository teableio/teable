/* eslint-disable @typescript-eslint/naming-convention */
const OCTET_STREAM = 'application/octet-stream';
const JSON_PREFIX = 'application/json';

/**
 * Check if a content type would be intercepted by Express body parser (e.g. application/json).
 * When uploading internally via localhost, these types cause the stream to be consumed
 * before reaching the upload handler, so we need to fall back to application/octet-stream.
 */
export const getSafeUploadContentType = (contentType: string): string => {
  if (contentType && contentType.startsWith(JSON_PREFIX)) {
    return OCTET_STREAM;
  }
  return contentType;
};

/**
 * Check if a mimetype mismatch is caused by the body parser fallback.
 * Returns true if the request used octet-stream as a substitute for a JSON content type.
 */
export const isBodyParserFallback = (mimetype: string, expectedType: string): boolean => {
  return mimetype === OCTET_STREAM && expectedType.startsWith(JSON_PREFIX);
};

export const getExtensionPreview = (contentType: string) => {
  const imageExtensions = [
    'jif',
    'jfif',
    'apng',
    'avif',
    'svg',
    'webp',
    'bmp',
    'ico',
    'jpg',
    'jpe',
    'jpeg',
    'gif',
    'png',
    'heic',
  ];
  const textExtensions = ['pdf', 'txt', 'json'];
  const audioExtensions = ['wav', 'mp3', 'alac', 'aiff', 'dsd', 'pcm'];
  const videoExtensions = [
    'mp4',
    'avi',
    'mpg',
    'webm',
    'mov',
    'flv',
    'mkv',
    'wmv',
    'avchd',
    'mpeg-4',
  ];

  if (imageExtensions.includes(contentType)) {
    return contentType;
  }
  if (textExtensions.includes(contentType)) {
    return contentType;
  }
  if (audioExtensions.includes(contentType)) {
    return contentType;
  }
  if (videoExtensions.includes(contentType)) {
    return contentType;
  }
  return 'application/octet-stream';
};
