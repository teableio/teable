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
  return mimetype.startsWith('application/pdf');
};

export const isWord = (mimetype: string) => {
  return mimetype.startsWith('application/msword');
};

export const isExcel = (mimetype: string) => {
  return mimetype.startsWith('application/vnd.ms-excel');
};

export const isPpt = (mimetype: string) => {
  return mimetype.startsWith('application/vnd.ms-powerpoint');
};

export const isMarkdown = (mimetype: string) => {
  return mimetype.startsWith('text/markdown');
};

export const isPackage = (mimetype: string) => {
  return mimetype.startsWith('application/zip');
};
