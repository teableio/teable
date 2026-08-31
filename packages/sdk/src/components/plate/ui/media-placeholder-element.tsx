'use client';

import { CommentNodeType } from '@teable/openapi';
import { cn, sonner } from '@teable/ui-lib';
import type { PlateElementProps } from '@udecode/plate/react';
import { PlateElement, useEditorPlugin, withHOC } from '@udecode/plate/react';
import type { TPlaceholderElement } from '@udecode/plate-media';
import {
  AudioPlugin,
  FilePlugin,
  ImagePlugin,
  PlaceholderPlugin,
  PlaceholderProvider,
  updateUploadHistory,
  VideoPlugin,
} from '@udecode/plate-media/react';
import { AudioLines, FileUp, Film, ImageIcon, Loader2Icon } from 'lucide-react';
import * as React from 'react';

import { useFilePicker } from 'use-file-picker';
import { useTranslation } from '../../../context/app/i18n';
import { useUploadFile } from './hooks/useUploadFile';

const CONTENT: Record<
  string,
  {
    accept: string[];
    content: React.ReactNode;
    icon: React.ReactNode;
  }
> = {
  [AudioPlugin.key]: {
    accept: ['audio/*'],
    content: 'Add an audio file',
    icon: <AudioLines />,
  },
  [FilePlugin.key]: {
    accept: ['*'],
    content: 'Add a file',
    icon: <FileUp />,
  },
  [ImagePlugin.key]: {
    accept: ['image/*'],
    content: 'Add an image',
    icon: <ImageIcon />,
  },
  [VideoPlugin.key]: {
    accept: ['video/*'],
    content: 'Add a video',
    icon: <Film />,
  },
};

const MediaPlaceholderElement = withHOC(
  PlaceholderProvider,
  function MediaPlaceholderElement(props: PlateElementProps<TPlaceholderElement>) {
    const { editor, element } = props;
    const { t } = useTranslation();

    const { api } = useEditorPlugin(PlaceholderPlugin);

    const { isUploading, progress, uploadedFile, uploadFile, uploadingFile } = useUploadFile();

    const loading = isUploading && uploadingFile;

    const currentContent = CONTENT[element.mediaType];

    const isImage = element.mediaType === ImagePlugin.key;

    const imageRef = React.useRef<HTMLImageElement>(null);

    const { openFilePicker } = useFilePicker({
      accept: currentContent.accept,
      multiple: true,
      onFilesSelected: ({ plainFiles: updatedFiles }) => {
        const firstFile = updatedFiles[0];
        const restFiles = updatedFiles.slice(1);

        replaceCurrentPlaceholder(firstFile);

        if (restFiles.length > 0) {
          editor.getTransforms(PlaceholderPlugin).insert.media(restFiles);
        }
      },
    });

    const replaceCurrentPlaceholder = React.useCallback(
      (file: File) => {
        api.placeholder.addUploadingFile(element.id as string, file);
        // a rejected upload used to be an unhandled rejection that left the
        // placeholder — and the plugin's uploading entry — in the document
        // forever, which now also means the composer could never send again
        uploadFile(file).catch(() => {
          sonner.toast.error(t('common.uploadFailed'));
          api.placeholder.removeUploadingFile(element.id as string);
          const path = editor.api.findPath(element);
          path && editor.tf.withoutSaving(() => editor.tf.removeNodes({ at: path }));
        });
      },
      [api.placeholder, editor, element, t, uploadFile]
    );

    React.useEffect(() => {
      if (!uploadedFile) return;

      const path = editor.api.findPath(element);

      const previousNode = editor.api.previous({ at: path });

      if (!path) return;

      editor.tf.withoutSaving(() => {
        editor.tf.removeNodes({ at: path });

        const node = {
          children: [{ text: '' }],
          initialHeight: imageRef.current?.height,
          initialWidth: imageRef.current?.width,
          isUpload: true,
          name: element.mediaType === FilePlugin.key ? uploadedFile.name : '',
          placeholderId: element.id as string,
          type: element.mediaType!,
          url: uploadedFile.url,
          path: uploadedFile.path,
        };

        if (previousNode?.[0]?.type === CommentNodeType.Img || !previousNode) {
          editor.tf.insertNodes(node, { at: path, nextBlock: true });
        } else {
          editor.tf.insertNodes(node, { at: path });
        }

        editor.tf.focus();

        updateUploadHistory(editor, node);
      });

      api.placeholder.removeUploadingFile(element.id as string);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uploadedFile, element.id]);

    // React dev mode will call React.useEffect twice
    const isReplaced = React.useRef(false);

    /** Paste and drop */
    React.useEffect(() => {
      if (isReplaced.current) return;

      isReplaced.current = true;
      const currentFiles = api.placeholder.getUploadingFile(element.id as string);

      if (!currentFiles) return;

      replaceCurrentPlaceholder(currentFiles);

      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isReplaced]);

    return (
      <PlateElement className="my-1" {...props}>
        {(!loading || !isImage) && (
          <div
            className={cn(
              'flex cursor-pointer items-center rounded-sm bg-muted p-3 pe-9 select-none hover:bg-primary/10'
            )}
            onClick={() => !loading && openFilePicker()}
            contentEditable={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                openFilePicker();
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="relative me-3 flex text-muted-foreground/80 [&_svg]:size-6">
              {currentContent.icon}
            </div>
            <div className="whitespace-nowrap text-sm text-muted-foreground">
              <div>{loading ? uploadingFile?.name : currentContent.content}</div>

              {loading && !isImage && (
                <div className="mt-1 flex items-center gap-1.5">
                  <div>{formatBytes(uploadingFile?.size ?? 0)}</div>
                  <div>–</div>
                  <div className="flex items-center">
                    <Loader2Icon className="me-1 size-3.5 animate-spin text-muted-foreground" />
                    {progress ?? 0}%
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {isImage && loading && (
          <ImageProgress file={uploadingFile} imageRef={imageRef} progress={progress} />
        )}

        {props.children}
      </PlateElement>
    );
  }
) as React.FC<PlateElementProps<TPlaceholderElement>>;

export { MediaPlaceholderElement };

export function ImageProgress({
  className,
  file,
  imageRef,
  progress = 0,
}: {
  file: File;
  className?: string;
  imageRef?: React.RefObject<HTMLImageElement | null>;
  progress?: number;
}) {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  if (!objectUrl) {
    return null;
  }

  const uploading = progress < 100;

  return (
    <div className={cn('relative', className)} contentEditable={false}>
      <img
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={imageRef as any}
        className={cn('h-auto w-full rounded-sm object-cover', uploading && 'opacity-40')}
        alt={file.name}
        src={objectUrl}
      />
      {uploading && (
        <>
          {/* the old bottom-corner chip was easy to miss on a busy image: dim the
              preview, put the progress in the middle, and track it along the base */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-full bg-black/70 px-2.5 py-1 text-white">
              <Loader2Icon className="size-4 animate-spin" />
              <span className="text-sm font-medium tabular-nums">{Math.round(progress)}%</span>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-sm bg-black/20">
            <div
              className="h-full bg-white transition-[width] duration-200"
              style={{ width: `${Math.max(progress, 2)}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export function formatBytes(
  bytes: number,
  opts: {
    decimals?: number;
    sizeType?: 'accurate' | 'normal';
  } = {}
) {
  const { decimals = 0, sizeType = 'normal' } = opts;

  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const accurateSizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB'];

  if (bytes === 0) return '0 Byte';

  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  return `${(bytes / Math.pow(1024, i)).toFixed(decimals)} ${
    sizeType === 'accurate' ? accurateSizes[i] ?? 'Bytest' : sizes[i] ?? 'Bytes'
  }`;
}
