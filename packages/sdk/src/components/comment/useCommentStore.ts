import type { ICommentVo } from '@teable/openapi';
import { noop } from 'lodash';
import { create } from 'zustand';

interface IEditorRef {
  focus: () => void;
  blur: () => void;
}

interface ICommentState {
  quoteId?: string;
  editingCommentId?: string;
  editorRef: IEditorRef;
  attachmentPresignedUrls: Record<string, string>;
  commentList: ICommentVo[];
  listRef: React.RefObject<HTMLDivElement> | null;

  setQuoteId: (quoteId?: string) => void;
  setEditingCommentId: (editingCommentId?: string) => void;
  setEditorRef: (editorRef: IEditorRef) => void;
  setAttachmentPresignedUrls: (path: string, url: string) => void;
  setCommentList: (list: ICommentVo[]) => void;

  resetCommentStore: () => void;
}

export const useCommentStore = create<ICommentState>((set) => ({
  quoteId: undefined,
  editingCommentId: undefined,
  attachmentPresignedUrls: {},
  commentList: [] as ICommentVo[],
  listRef: null,
  setQuoteId: (quoteId?: string) => {
    set((state) => {
      return {
        ...state,
        editingCommentId: undefined,
        quoteId,
      };
    });
  },
  setEditingCommentId: (editingCommentId?: string) => {
    set((state) => {
      return {
        ...state,
        quoteId: undefined,
        editingCommentId,
      };
    });
  },
  editorRef: {
    focus: noop,
    blur: noop,
  },
  setAttachmentPresignedUrls: (path: string, url: string) => {
    set((state) => {
      return {
        ...state,
        attachmentPresignedUrls: {
          ...state.attachmentPresignedUrls,
          [path]: url,
        },
      };
    });
  },
  setCommentList: (list: ICommentVo[]) => {
    set((state) => {
      return {
        ...state,
        commentList: [...list],
      };
    });
  },
  setEditorRef: (editorRef: IEditorRef) => {
    set((state) => {
      return {
        ...state,
        editorRef,
      };
    });
  },
  resetCommentStore: () => {
    set(() => {
      return {
        quoteId: undefined,
        editingCommentId: undefined,
        attachmentPresignedUrls: {},
        commentList: [] as ICommentVo[],
        editorRef: {
          focus: noop,
          blur: noop,
        },
      };
    });
  },
}));
