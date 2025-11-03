import {
  FileAudio,
  FileDocument,
  FileImage,
  FilePack,
  FilePdf,
  FilePresentation,
  FileSpreadsheet,
  FileUnknown,
  FileVideo,
} from '@teable/icons';
import { isAudio, isExcel, isImage, isPackage, isPdf, isPpt, isVideo, isWord } from './utils';

export const getFileIcon = (mimetype: string) => {
  if (isImage(mimetype)) {
    return FileImage;
  }
  if (isPdf(mimetype)) {
    return FilePdf;
  }
  if (isExcel(mimetype)) {
    return FileSpreadsheet;
  }
  if (isWord(mimetype)) {
    return FileDocument;
  }
  if (isPackage(mimetype)) {
    return FilePack;
  }
  if (isAudio(mimetype)) {
    return FileAudio;
  }
  if (isVideo(mimetype)) {
    return FileVideo;
  }
  if (isPpt(mimetype)) {
    return FilePresentation;
  }
  return FileUnknown;
};
