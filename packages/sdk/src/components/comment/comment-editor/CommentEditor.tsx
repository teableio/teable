import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ICreateCommentRo, IUpdateCommentRo } from '@teable/openapi';
import { createComment, getCommentDetail, updateComment } from '@teable/openapi';
import {
  Button,
  cn,
  sonner,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import type { Editor } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import { AtSignIcon, ImageIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useCommentPermission, useIsTouchDevice } from '../../../hooks';
import { useModalRefElement } from '../../expand-record/useModalRefElement';
import { useCommentStore } from '../useCommentStore';
import { CommentQuote } from './CommentQuote';
import { CommentImage } from './extensions/image';
import type { IImageRejectReason } from './extensions/image-upload';
import {
  COMMENT_IMAGE_MAX_COUNT,
  COMMENT_IMAGE_MAX_SIZE,
  hasUploadingImage,
  insertCommentImages,
} from './extensions/image-upload';
import type { IMentionItem } from './extensions/mention';
import { CommentMention, commentMentionPluginKey } from './extensions/mention';
import { LinkToolbar } from './LinkToolbar';
import type { IMentionListHandle } from './MentionMenu';
import { MentionList, MentionSheet } from './MentionMenu';
import { commentToEditorDoc, editorDocToComment } from './transform';

interface ICommentEditorProps {
  tableId: string;
  recordId: string;
}

interface IMentionState {
  props: SuggestionProps<IMentionItem>;
  /** the floating list's mount point; absent on touch devices, which use a sheet */
  element?: HTMLElement;
}

const ToolbarButton = (
  props: React.ComponentProps<typeof Button> & { tooltip: string; children: React.ReactNode }
) => {
  const { tooltip, children, ...rest } = props;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={tooltip} {...rest}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
};

const MENTION_LEAF_TEXT = String.fromCodePoint(0xfffc);

const clearEditor = (editor: Editor) => {
  // a sent comment is not something to undo back into the box
  editor.chain().setMeta('addToHistory', false).clearContent().run();
};

export const CommentEditor = (props: ICommentEditorProps) => {
  const { tableId, recordId } = props;
  const { t } = useTranslation();
  const { quoteId, setQuoteId, setEditorRef, editingCommentId, setEditingCommentId } =
    useCommentStore();
  const { commentWritable } = useCommentPermission();
  const queryClient = useQueryClient();
  const modalElementRef = useModalRefElement();
  const isTouchDevice = useIsTouchDevice();
  const [mention, setMention] = useState<IMentionState | null>(null);
  const [linkEditing, setLinkEditing] = useState(false);
  const mentionListRef = useRef<IMentionListHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isTouchDeviceRef = useRef(isTouchDevice);
  isTouchDeviceRef.current = isTouchDevice;
  const submitRef = useRef<() => void>(() => undefined);
  const rejectRef = useRef<(reason: IImageRejectReason) => void>(() => undefined);

  rejectRef.current = (reason) => {
    const message = {
      tooLarge: t('httpErrors.attachment.fileSizeExceedsMaximumLimit', {
        maxSize: `${COMMENT_IMAGE_MAX_SIZE / 1024 / 1024}MB`,
      }),
      tooMany: t('comment.tooManyImages', { count: COMMENT_IMAGE_MAX_COUNT }),
      uploadFailed: t('common.uploadFailed'),
    }[reason];
    sonner.toast.error(message);
  };

  const mentionRender: SuggestionOptions<IMentionItem>['render'] = () => {
    let element: HTMLElement | undefined;
    let unmount: (() => void) | undefined;
    return {
      onStart: (props) => {
        if (!isTouchDeviceRef.current) {
          // inside the record modal, so the modal does not read clicks on the list as outside
          element = document.createElement('div');
          element.style.zIndex = '50';
          (modalElementRef.current ?? document.body).appendChild(element);
          unmount = props.mount(element);
        }
        setMention({ props, element });
      },
      onUpdate: (props) => setMention((prev) => prev && { ...prev, props }),
      onKeyDown: ({ event }) => mentionListRef.current?.onKeyDown(event) ?? false,
      onExit: () => {
        unmount?.();
        element?.remove();
        unmount = undefined;
        element = undefined;
        setMention(null);
      },
    };
  };

  const editor = useEditor(
    {
      immediatelyRender: false,
      autofocus: true,
      extensions: [
        StarterKit.configure({
          // a comment is plain paragraphs with links, mentions and images
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          listItem: false,
          listKeymap: false,
          orderedList: false,
          strike: false,
          underline: false,
          link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' },
        }),
        Placeholder.configure({ placeholder: t('comment.placeholder') }),
        CommentImage.configure({ onReject: (reason) => rejectRef.current(reason) }),
        CommentMention.configure({ suggestion: { render: mentionRender } }),
      ],
      editorProps: {
        attributes: {
          class: cn(
            'h-[130px] w-full overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-sm outline-none',
            '[&_p]:m-0 [&_p]:leading-6',
            '[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:decoration-primary [&_a]:underline-offset-4',
            '[&_.suggestion]:text-primary',
            '[&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-start [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-muted-foreground [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]'
          ),
        },
        handleKeyDown: (view, event) => {
          // the record modal closes on Escape; inside the editor it only leaves the editor
          if (event.key === 'Escape') event.stopPropagation();
          // the open @ list takes Enter, arrows and Escape
          if (commentMentionPluginKey.getState(view.state)?.active) return false;
          if (event.key === 'Escape') {
            view.dom.blur();
            modalElementRef.current?.focus();
            return true;
          }
          const composing = event.isComposing || view.composing || event.keyCode === 229;
          if (event.key === 'Enter' && !event.shiftKey && !composing) {
            event.preventDefault();
            submitRef.current();
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            setLinkEditing(true);
            return true;
          }
          return false;
        },
      },
    },
    [recordId]
  );

  const { data: editingComment } = useQuery({
    queryKey: [editingCommentId],
    queryFn: () => getCommentDetail(tableId!, recordId!, editingCommentId!).then((res) => res.data),
    enabled: !!tableId && !!recordId && !!editingCommentId,
    staleTime: 0,
  });

  useEffect(() => {
    if (!editor || !editingCommentId || !editingComment) return;
    editor.chain().setContent(commentToEditorDoc(editingComment.content)).focus('end').run();
  }, [editor, editingCommentId, editingComment]);

  useEffect(() => {
    if (!editor) return;
    setEditorRef({
      focus: () => editor.commands.focus(),
      blur: () => editor.commands.blur(),
    });
  }, [editor, setEditorRef]);

  const { mutate: createCommentFn, isPending: isCreating } = useMutation({
    mutationFn: (createCommentRo: ICreateCommentRo) =>
      createComment(tableId, recordId, createCommentRo),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.recordCommentCount(tableId, recordId),
      });
      editor && clearEditor(editor);
      setQuoteId(undefined);
    },
  });

  const { mutate: updateCommentFn, isPending: isUpdating } = useMutation({
    mutationFn: ({
      commentId,
      updateCommentRo,
    }: {
      commentId: string;
      updateCommentRo: IUpdateCommentRo;
    }) => updateComment(tableId, recordId, commentId, updateCommentRo),
    onSuccess: () => {
      editor && clearEditor(editor);
      setQuoteId(undefined);
      setEditingCommentId(undefined);
    },
  });

  submitRef.current = () => {
    // an image still uploading would be sent without it
    if (!editor || !commentWritable || isCreating || isUpdating) return;
    if (hasUploadingImage(editor.state.doc)) return;
    const content = editorDocToComment(editor.getJSON());
    if (!content.length) return;
    if (editingCommentId) {
      updateCommentFn({ commentId: editingCommentId, updateCommentRo: { content } });
    } else {
      createCommentFn({ quoteId, content });
    }
  };

  const insertMentionTrigger = () => {
    if (!editor) return;
    const { $from } = editor.state.selection;
    const before = $from.parent.textBetween(
      Math.max(0, $from.parentOffset - 1),
      $from.parentOffset,
      undefined,
      // a mention right before the caret is a word too
      MENTION_LEAF_TEXT
    );
    // the list only opens for an @ that starts a word
    editor
      .chain()
      .focus()
      .insertContent(before && !/\s/.test(before) ? ' @' : '@')
      .run();
  };

  return (
    <TooltipProvider>
      <div>
        {editingCommentId && (
          <div className="flex h-10 w-full items-center justify-between bg-secondary p-2 text-sm">
            <span>{t('comment.tip.editing')}</span>
            <Button
              size={'xs'}
              variant={'default'}
              onClick={() => {
                setEditingCommentId(undefined);
                if (!editor) return;
                clearEditor(editor);
                editor.commands.focus();
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        )}
        <CommentQuote
          quoteId={quoteId}
          onClose={() => {
            setQuoteId(undefined);
          }}
        />
        {/* image / mention insertion are writes too — a read-only viewer keeps
            the panel, not the composer's tools */}
        {commentWritable && (
          <>
            <div className="no-scrollbar flex gap-x-1 border-y p-1">
              <ToolbarButton
                tooltip={t('comment.toolbar.image')}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImageIcon className="size-3.5" />
              </ToolbarButton>
              <ToolbarButton
                tooltip={t('comment.toolbar.mention')}
                // keep the caret where the author was typing
                onMouseDown={(e) => e.preventDefault()}
                onClick={insertMentionTrigger}
              >
                <AtSignIcon className="size-3.5" />
              </ToolbarButton>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (editor) insertCommentImages(editor, files, rejectRef.current);
                }}
              />
            </div>
            <EditorContent editor={editor} />
          </>
        )}
        {editor && commentWritable && (
          <LinkToolbar
            editor={editor}
            container={modalElementRef.current ?? document.body}
            editing={linkEditing}
            onEditingChange={setLinkEditing}
          />
        )}
        {mention &&
          (mention.element ? (
            createPortal(
              <MentionList
                ref={mentionListRef}
                query={mention.props.query}
                onSelect={(item) => mention.props.command(item)}
              />,
              mention.element
            )
          ) : (
            <MentionSheet
              onSelect={(item) => mention.props.command(item)}
              onDismiss={() => editor?.chain().focus().deleteRange(mention.props.range).run()}
            />
          ))}
      </div>
    </TooltipProvider>
  );
};
