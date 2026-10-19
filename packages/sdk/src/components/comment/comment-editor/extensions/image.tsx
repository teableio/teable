import { cn, FilePreviewItem, FilePreviewProvider } from '@teable/ui-lib';
import { mergeAttributes, Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { COMMENT_IMAGE_NODE } from '../transform';
import type { IImageRejectReason } from './image-upload';
import { insertCommentImages, useImageUpload } from './image-upload';

const MIN_WIDTH = 40;

const UploadingImage = ({ file, progress }: { file: File; progress: number }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!objectUrl) return null;

  return (
    <div className="relative w-fit max-w-full">
      <img
        className="h-auto max-w-full rounded-sm object-cover opacity-40"
        alt={file.name}
        src={objectUrl}
      />
      {/* dim the preview, put the progress in the middle, and track it along the base */}
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
    </div>
  );
};

const CommentImageView = (props: NodeViewProps) => {
  const { node, editor, selected, updateAttributes } = props;
  const { url, width, uploadId } = node.attrs as {
    url: string | null;
    width: number | null;
    uploadId: string | null;
  };
  const upload = useImageUpload(uploadId);
  const imageRef = useRef<HTMLImageElement>(null);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);

  const startResize = (event: React.PointerEvent) => {
    const image = imageRef.current;
    const container = image?.closest('.ProseMirror');
    if (!image || !container) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = image.getBoundingClientRect().width;
    const maxWidth = container.getBoundingClientRect().width;
    // the handle sits on the inline end, which is the left edge in RTL
    const direction = getComputedStyle(image).direction === 'rtl' ? -1 : 1;
    let next: number | null = null;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) * direction;
      next = Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + delta)));
      setDraftWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDraftWidth(null);
      // a click on the handle without dragging is not a resize
      if (next !== null) updateAttributes({ width: next });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const renderContent = () => {
    if (upload) return <UploadingImage file={upload.file} progress={upload.progress} />;
    if (!url) return null;
    const displayWidth = draftWidth ?? width;
    return (
      <div
        role="presentation"
        className="group relative w-fit max-w-full"
        // a click selects the image (to delete or drag it); a double click previews it
        onClickCapture={(e) => e.detail !== 2 && e.stopPropagation()}
      >
        <FilePreviewItem src={url} name="comment-img" mimetype="image/jpeg">
          <img
            ref={imageRef}
            src={url}
            alt="img"
            style={displayWidth ? { width: displayWidth } : undefined}
            className={cn(
              'block max-w-full cursor-pointer rounded-sm',
              selected && 'ring-2 ring-ring ring-offset-2'
            )}
            draggable={false}
          />
        </FilePreviewItem>
        {editor.isEditable && (
          <div
            className="absolute inset-y-0 -end-3 flex w-6 cursor-col-resize items-center justify-center"
            onPointerDown={startResize}
          >
            <div className="h-16 max-h-full w-[3px] rounded-[6px] bg-ring opacity-0 group-hover:opacity-100" />
          </div>
        )}
      </div>
    );
  };

  return (
    <NodeViewWrapper className="py-1" data-drag-handle>
      <FilePreviewProvider>{renderContent()}</FilePreviewProvider>
    </NodeViewWrapper>
  );
};

export interface ICommentImageOptions {
  onReject: (reason: IImageRejectReason) => void;
}

const imageFiles = (files: FileList | null | undefined) =>
  Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));

/**
 * A block image. `path` is what the comment stores; `url` is the presigned url
 * to display it; `uploadId` marks a block whose upload is still in flight.
 */
export const CommentImage = Node.create<ICommentImageOptions>({
  name: COMMENT_IMAGE_NODE,
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { onReject: () => undefined };
  },

  addAttributes() {
    return {
      path: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-path'),
        renderHTML: (attrs) => (attrs.path ? { 'data-path': attrs.path } : {}),
      },
      url: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-url'),
        renderHTML: (attrs) => (attrs.url ? { 'data-url': attrs.url } : {}),
      },
      width: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-width')) || null,
        renderHTML: (attrs) => (attrs.width ? { 'data-width': attrs.width } : {}),
      },
      uploadId: { default: null, rendered: false },
    };
  },

  // only our own blocks paste back in: a foreign <img> has no attachment path to save
  parseHTML() {
    return [{ tag: 'div[data-type="comment-image"][data-path]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'comment-image' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CommentImageView);
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    const { onReject } = this.options;
    return [
      new Plugin({
        key: new PluginKey('commentImagePasteDrop'),
        props: {
          handlePaste: (_view, event) => {
            const files = imageFiles(event.clipboardData?.files);
            if (!files.length) return false;
            return insertCommentImages(editor, files, onReject);
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const files = imageFiles(event.dataTransfer?.files);
            if (!files.length) return false;
            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            return insertCommentImages(editor, files, onReject, pos);
          },
        },
      }),
    ];
  },
});
