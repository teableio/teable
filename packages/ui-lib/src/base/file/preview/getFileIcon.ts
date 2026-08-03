import {
  FileAudio,
  FileAudioDark,
  FileDocument,
  FileDocumentDark,
  FileImage,
  FilePack,
  FilePackDark,
  FilePdf,
  FilePdfDark,
  FilePresentation,
  FilePresentationDark,
  FileSpreadsheetDark,
  FileSpreadsheet,
  FileUnknown,
  FileUnknownDark,
  FileVideo,
  FileVideoDark,
} from '@teable/icons';
import { isAudio, isExcel, isImage, isPackage, isPdf, isPpt, isVideo, isWord } from './utils';

// eslint-disable-next-line sonarjs/cognitive-complexity
export const getFileIcon = (mimetype: string, theme?: 'light' | 'dark') => {
  if (isImage(mimetype)) {
    return FileImage;
  }
  if (isPdf(mimetype)) {
    return theme === 'dark' ? FilePdfDark : FilePdf;
  }
  if (isExcel(mimetype)) {
    return theme === 'dark' ? FileSpreadsheetDark : FileSpreadsheet;
  }
  if (isWord(mimetype)) {
    return theme === 'dark' ? FileDocumentDark : FileDocument;
  }
  if (isPackage(mimetype)) {
    return theme === 'dark' ? FilePackDark : FilePack;
  }
  if (isAudio(mimetype)) {
    return theme === 'dark' ? FileAudioDark : FileAudio;
  }
  if (isVideo(mimetype)) {
    return theme === 'dark' ? FileVideoDark : FileVideo;
  }
  if (isPpt(mimetype)) {
    return theme === 'dark' ? FilePresentationDark : FilePresentation;
  }
  return theme === 'dark' ? FileUnknownDark : FileUnknown;
};
