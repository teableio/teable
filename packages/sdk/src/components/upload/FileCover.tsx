import { useTheme } from '@teable/next-themes';
import {
  cn,
  getFileIcon,
  isAudio,
  isExcel,
  isImage,
  isPackage,
  isPpt,
  isVideo,
  isWord,
} from '@teable/ui-lib';
import { useMemo } from 'react';

interface IFileCoverProps {
  className?: string;
  mimetype: string;
  url?: string;
  name?: string;
}

const bgColorMap = {
  light: {
    package: '#FEF3C7',
    video: '#F3E8FF',
    ppt: '#FEE2E2',
    doc: '#DBEAFE',
    excel: '#D1FAE5',
    audio: '#FCE7F3',
    unknown: '#F4F4F5',
  },
  dark: {
    package: 'rgba(255, 224, 143, 0.16)',
    video: 'rgba(168, 85, 247, 0.16)',
    ppt: 'rgba(239, 68, 68, 0.16)',
    doc: 'rgba(59, 130, 246, 0.16)',
    excel: 'rgba(81, 249, 193, 0.16)',
    audio: 'rgba(255, 149, 201, 0.16)',
    unknown: 'rgba(244, 244, 245, 0.16)',
  },
};

const getBgColor = (mimetype: string): { light: string; dark: string } => {
  if (isPackage(mimetype)) {
    return { light: bgColorMap.light.package, dark: bgColorMap.dark.package };
  }
  if (isVideo(mimetype)) {
    return { light: bgColorMap.light.video, dark: bgColorMap.dark.video };
  }
  if (isPpt(mimetype)) {
    return { light: bgColorMap.light.ppt, dark: bgColorMap.dark.ppt };
  }
  if (isWord(mimetype)) {
    return { light: bgColorMap.light.doc, dark: bgColorMap.dark.doc };
  }
  if (isExcel(mimetype)) {
    return { light: bgColorMap.light.excel, dark: bgColorMap.dark.excel };
  }
  if (isAudio(mimetype)) {
    return { light: bgColorMap.light.audio, dark: bgColorMap.dark.audio };
  }
  return { light: bgColorMap.light.unknown, dark: bgColorMap.dark.unknown };
};

export const FileCover = (props: IFileCoverProps) => {
  const { className, mimetype, url, name } = props;
  const { resolvedTheme } = useTheme();
  const { light, dark } = getBgColor(mimetype);
  const FileIcon = useMemo(() => getFileIcon(mimetype), [mimetype]);

  if (isImage(mimetype)) {
    return <img className={className} src={url} alt={name} />;
  }
  return (
    <div
      className={cn('flex items-center justify-center', className)}
      style={{ background: resolvedTheme === 'dark' ? dark : light }}
    >
      <FileIcon className={'size-20'} />
    </div>
  );
};
