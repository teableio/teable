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
