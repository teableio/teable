import { generateAttachmentId } from '@teable/core';
import type { INotifyVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { useSyncExternalStore } from 'react';
import { AttachmentManager } from '../../../editor';
import { COMMENT_IMAGE_NODE } from '../transform';

export const COMMENT_IMAGE_MAX_SIZE = 4 * 1024 * 1024;
export const COMMENT_IMAGE_MAX_COUNT = 3;

export type IImageRejectReason = 'tooLarge' | 'tooMany' | 'uploadFailed';

interface IUploadEntry {
  file: File;
  progress: number;
}

// Upload state lives outside the document: progress ticks would otherwise land
// in the undo history, and a File can't be stored in node attrs.
const uploads = new Map<string, IUploadEntry>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useImageUpload = (uploadId: string | null) =>
  useSyncExternalStore(
    subscribe,
    () => (uploadId ? uploads.get(uploadId) : undefined),
    () => undefined
  );

export const hasUploadingImage = (doc: PMNode) => {
  let uploading = false;
  doc.descendants((node) => {
    if (node.type.name === COMMENT_IMAGE_NODE && node.attrs.uploadId) uploading = true;
    return !uploading;
  });
  return uploading;
};

const findImagePos = (editor: Editor, uploadId: string) => {
  let pos: number | undefined;
  editor.state.doc.descendants((node, nodePos) => {
    if (node.type.name === COMMENT_IMAGE_NODE && node.attrs.uploadId === uploadId) pos = nodePos;
    return pos === undefined;
  });
  return pos;
};

const settle = (editor: Editor, uploadId: string, result: { path: string; url: string } | null) => {
  uploads.delete(uploadId);
  notify();
  if (editor.isDestroyed) return;
  const pos = findImagePos(editor, uploadId);
  // the author undid or deleted the image while it was uploading
  if (pos === undefined) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const tr = result
    ? editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...result, uploadId: null })
    : editor.state.tr.delete(pos, pos + node.nodeSize);
  // the upload finishing is not an edit the author should be able to undo
  editor.view.dispatch(tr.setMeta('addToHistory', false));
};

const upload = (editor: Editor, uploadId: string, file: File, onReject: () => void) => {
  new AttachmentManager(1).upload([{ id: uploadId, instance: file }], UploadType.Comment, {
    successCallback: (_, result: INotifyVo) => {
      settle(editor, uploadId, { path: result.path, url: result.presignedUrl });
    },
    errorCallback: () => {
      settle(editor, uploadId, null);
      onReject();
    },
    progressCallback: (_, progress) => {
      const entry = uploads.get(uploadId);
      if (!entry) return;
      uploads.set(uploadId, { ...entry, progress });
      notify();
    },
  });
};

/**
 * Inserts the image files as blocks at `pos` (the selection when omitted) and
 * uploads them. Each block shows its local preview and progress until the
 * upload lands, then carries the attachment path the comment is saved with.
 * Returns whether any of the files was an image, so paste/drop know whether
 * they handled the event.
 */
export const insertCommentImages = (
  editor: Editor,
  files: File[],
  onReject: (reason: IImageRejectReason) => void,
  pos?: number
) => {
  const images = files.filter((file) => file.type.startsWith('image/'));
  if (!images.length) return false;

  if (images.length > COMMENT_IMAGE_MAX_COUNT) onReject('tooMany');
  const accepted = images.slice(0, COMMENT_IMAGE_MAX_COUNT).filter((file) => {
    const fits = file.size <= COMMENT_IMAGE_MAX_SIZE;
    if (!fits) onReject('tooLarge');
    return fits;
  });
  if (!accepted.length) return true;

  const nodes: JSONContent[] = accepted.map((file) => {
    const uploadId = generateAttachmentId();
    uploads.set(uploadId, { file, progress: 0 });
    return { type: COMMENT_IMAGE_NODE, attrs: { uploadId } };
  });
  notify();

  const chain = editor.chain().focus();
  (pos === undefined ? chain.insertContent(nodes) : chain.insertContentAt(pos, nodes)).run();

  nodes.forEach((node, index) =>
    upload(editor, node.attrs!.uploadId, accepted[index], () => onReject('uploadFailed'))
  );
  return true;
};
