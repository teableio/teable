import { CommentNodeType } from '@teable/openapi';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { editorDocToComment } from '../transform';
import { CommentImage } from './image';
import {
  COMMENT_IMAGE_MAX_COUNT,
  COMMENT_IMAGE_MAX_SIZE,
  hasUploadingImage,
  insertCommentImages,
} from './image-upload';

interface IPendingUpload {
  success: (result: { path: string; presignedUrl: string }) => void;
  error: () => void;
  progress: (value: number) => void;
}

const pending: IPendingUpload[] = [];

vi.mock('../../../editor', () => ({
  AttachmentManager: class {
    upload(
      _files: unknown[],
      _type: unknown,
      callbacks: {
        successCallback: (file: unknown, result: unknown) => void;
        errorCallback: (file: unknown) => void;
        progressCallback: (file: unknown, progress: number) => void;
      }
    ) {
      pending.push({
        success: (result) => callbacks.successCallback(undefined, result),
        error: () => callbacks.errorCallback(undefined),
        progress: (value) => callbacks.progressCallback(undefined, value),
      });
    }
  },
}));

const createEditor = () =>
  new Editor({
    extensions: [
      StarterKit,
      // the React node view needs a mounted EditorContent; the document logic does not
      CommentImage.extend({ addNodeView: () => null }),
    ],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    },
  });

const image = (name: string, size = 10, type = 'image/png') => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('insertCommentImages', () => {
  beforeEach(() => {
    pending.length = 0;
  });

  it('holds the comment while uploading, then saves the uploaded path', () => {
    const editor = createEditor();
    const onReject = vi.fn();

    expect(insertCommentImages(editor, [image('a.png')], onReject)).toBe(true);
    expect(hasUploadingImage(editor.state.doc)).toBe(true);
    expect(editorDocToComment(editor.getJSON())).toEqual([
      { type: CommentNodeType.Paragraph, children: [{ type: CommentNodeType.Text, value: 'hi' }] },
    ]);

    pending[0].progress(50);
    pending[0].success({ path: 'comment/a', presignedUrl: 'https://s3/a' });

    expect(hasUploadingImage(editor.state.doc)).toBe(false);
    expect(editorDocToComment(editor.getJSON())).toContainEqual({
      type: CommentNodeType.Img,
      path: 'comment/a',
    });
    expect(onReject).not.toHaveBeenCalled();
    editor.destroy();
  });

  it('removes the image and reports when the upload fails', () => {
    const editor = createEditor();
    const onReject = vi.fn();

    insertCommentImages(editor, [image('a.png')], onReject);
    pending[0].error();

    expect(onReject).toHaveBeenCalledWith('uploadFailed');
    expect(hasUploadingImage(editor.state.doc)).toBe(false);
    expect(editor.getJSON().content?.some((node) => node.type === 'commentImage')).toBe(false);
    editor.destroy();
  });

  it('ignores an upload that finishes after the author removed the image', () => {
    const editor = createEditor();

    insertCommentImages(editor, [image('a.png')], vi.fn());
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });

    expect(() =>
      pending[0].success({ path: 'comment/a', presignedUrl: 'https://s3/a' })
    ).not.toThrow();
    expect(editorDocToComment(editor.getJSON())).toEqual([]);
    editor.destroy();
  });

  it('rejects oversized images and caps how many are added at once', () => {
    const editor = createEditor();
    const onReject = vi.fn();
    const files = [
      image('big.png', COMMENT_IMAGE_MAX_SIZE + 1),
      ...Array.from({ length: COMMENT_IMAGE_MAX_COUNT }, (_, i) => image(`${i}.png`)),
    ];

    insertCommentImages(editor, files, onReject);

    expect(onReject).toHaveBeenCalledWith('tooMany');
    expect(onReject).toHaveBeenCalledWith('tooLarge');
    // the first three are taken, and the oversized one among them is dropped
    expect(pending).toHaveLength(COMMENT_IMAGE_MAX_COUNT - 1);
    editor.destroy();
  });

  it('leaves non-image files to the editor', () => {
    const editor = createEditor();

    expect(insertCommentImages(editor, [image('a.pdf', 10, 'application/pdf')], vi.fn())).toBe(
      false
    );
    expect(pending).toHaveLength(0);
    editor.destroy();
  });
});
