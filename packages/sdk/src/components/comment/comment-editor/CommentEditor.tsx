import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ICreateCommentRo, IUpdateCommentRo } from '@teable/openapi';
import { createComment, getCommentDetail, updateComment } from '@teable/openapi';
import { Button, TooltipProvider } from '@teable/ui-lib';
import type { TElement } from '@udecode/plate';
import { usePlateEditor, Plate, ParagraphPlugin } from '@udecode/plate/react';
import { AlignPlugin } from '@udecode/plate-alignment/react';
import { LinkPlugin } from '@udecode/plate-link/react';
import { ImagePlugin, PlaceholderPlugin } from '@udecode/plate-media/react';
import { MentionInputPlugin, MentionPlugin } from '@udecode/plate-mention/react';
import { SelectOnBackspacePlugin, DeletePlugin } from '@udecode/plate-select';
import { TrailingBlockPlugin } from '@udecode/plate-trailing-block';
import { noop } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useTablePermission } from '../../../hooks';
import { useModalRefElement } from '../../expand-record/useModalRefElement';
import { ImageElement } from '../../plate/ui/image-element';
import { ImagePreview } from '../../plate/ui/image-preview';
import { LinkElement } from '../../plate/ui/link-element';
import { LinkFloatingToolbar } from '../../plate/ui/link-floating-toolbar';
import { LinkToolbarButton } from '../../plate/ui/link-toolbar-button';
import { MediaPlaceholderElement } from '../../plate/ui/media-placeholder-element';
import { MediaToolbarButton } from '../../plate/ui/media-toolbar-button';
import { MediaUploadToast } from '../../plate/ui/media-upload-toast';
import { MentionElement } from '../../plate/ui/mention-element';
import { MentionInputElement } from '../../plate/ui/mention-input-element';
import { ParagraphElement } from '../../plate/ui/paragraph-element';
import { Toolbar } from '../../plate/ui/toolbar';
import { MentionUser } from '../comment-list/node';
import { useCommentStore } from '../useCommentStore';
import { CommentQuote } from './CommentQuote';
import { Editor } from './Editor';
import { EditorTransform } from './transform';

interface ICommentEditorProps {
  tableId: string;
  recordId: string;
}

const defaultEditorValue = [
  {
    type: 'p',
    children: [{ text: '' }],
  },
] as TElement[];

export const CommentEditor = (props: ICommentEditorProps) => {
  const { tableId, recordId } = props;
  const editorRef = useRef({
    focus: noop,
    blur: noop,
  });
  const { t } = useTranslation();
  const { quoteId, setQuoteId, setEditorRef, editingCommentId, setEditingCommentId } =
    useCommentStore();
  const [composition, setComposition] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mentionUserRender = (element: any) => {
    const value = element.value;
    return <MentionUser id={value.id} name={value.name} avatar={value.avatar} />;
  };
  const [value, setValue] = useState(defaultEditorValue);
  const permission = useTablePermission();
  const queryClient = useQueryClient();
  const modalElementRef = useModalRefElement();

  const editor = usePlateEditor({
    id: recordId,
    plugins: [
      ImagePlugin.configure({
        options: {
          disableUploadInsert: false,
          disableEmbedInsert: false,
        },
        render: { afterEditable: ImagePreview },
      }),
      LinkPlugin.configure({
        render: { afterEditable: () => <LinkFloatingToolbar /> },
      }),
      SelectOnBackspacePlugin.configure({
        options: {
          query: {
            allow: [ImagePlugin.key],
          },
        },
      }),
      DeletePlugin,
      ParagraphPlugin,
      AlignPlugin.configure({
        options: {
          targetPlugins: [ParagraphPlugin.key, ImagePlugin.key, MentionPlugin.key],
        },
      }),
      TrailingBlockPlugin,
      PlaceholderPlugin.configure({
        options: {
          disableEmptyPlaceholder: true,
          uploadConfig: {
            image: {
              mediaType: ImagePlugin.key,
              maxFileCount: 3,
              maxFileSize: '4MB',
            },
          },
          multiple: false,
        },
        render: { afterEditable: MediaUploadToast },
      }),
      MentionPlugin.configure({
        options: {
          triggerPreviousCharPattern: /^$|^[\s"']$/,
        },
      }),
    ],
    override: {
      components: {
        [LinkPlugin.key]: LinkElement,
        [ImagePlugin.key]: ImageElement,
        [PlaceholderPlugin.key]: MediaPlaceholderElement,
        [ParagraphPlugin.key]: ParagraphElement,
        [MentionPlugin.key]: (props: React.ComponentProps<typeof MentionElement>) => (
          <MentionElement {...props} render={mentionUserRender} />
        ),
        [MentionInputPlugin.key]: MentionInputElement,
      },
    },
    shouldNormalizeEditor: true,
    value: value,
  });
  const { data: editingComment } = useQuery({
    queryKey: [editingCommentId],
    queryFn: () => getCommentDetail(tableId!, recordId!, editingCommentId!).then((res) => res.data),
    enabled: !!tableId && !!recordId && !!editingCommentId,
  });
  useEffect(() => {
    // todo replace Standard api to reset to value
    if (editingCommentId && editingComment) {
      editor.tf.reset();
      editor.tf.insertNodes(EditorTransform.commentValue2EditorValue(editingComment.content), {
        at: [0],
      });
    }
  }, [editingCommentId, editor, editingComment, tableId, recordId]);
  useEffect(() => {
    editorRef.current = {
      focus: () => editor.tf.focus(),
      blur: () => editor.tf.blur(),
    };
    setEditorRef(editorRef.current);
  }, [editor, setEditorRef]);
  useEffect(() => {
    editor.tf.focus();
  }, [editor]);
  const { mutateAsync: createCommentFn } = useMutation({
    mutationFn: ({
      tableId,
      recordId,
      createCommentRo,
    }: {
      tableId: string;
      recordId: string;
      createCommentRo: ICreateCommentRo;
    }) => createComment(tableId, recordId, createCommentRo),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.recordCommentCount(tableId, recordId),
      });
      editor.tf.reset();
      setQuoteId(undefined);
    },
  });
  const { mutateAsync: updateCommentFn } = useMutation({
    mutationFn: ({
      tableId,
      recordId,
      commentId,
      updateCommentRo,
    }: {
      tableId: string;
      recordId: string;
      commentId: string;
      updateCommentRo: IUpdateCommentRo;
    }) => updateComment(tableId, recordId, commentId, updateCommentRo),
    onSuccess: () => {
      editor.tf.reset();
      setQuoteId(undefined);
      setEditingCommentId(undefined);
    },
  });
  const submit = () => {
    if (!EditorTransform.editorValue2CommentValue(value).length) {
      return;
    }
    if (editingCommentId) {
      updateCommentFn({
        tableId,
        recordId,
        commentId: editingCommentId,
        updateCommentRo: {
          content: EditorTransform.editorValue2CommentValue(value),
        },
      });
    } else {
      createCommentFn({
        tableId,
        recordId,
        createCommentRo: {
          quoteId: quoteId,
          content: EditorTransform.editorValue2CommentValue(value),
        },
      });
    }
  };

  return (
    <TooltipProvider>
      <div>
        <Plate
          editor={editor}
          onChange={({ value }) => {
            setValue(value);
          }}
        >
          {editingCommentId && (
            <div className="flex h-10 w-full items-center justify-between bg-secondary p-2 text-sm">
              <span>{t('comment.tip.editing')}</span>

              <Button
                size={'xs'}
                variant={'default'}
                onClick={() => {
                  setEditingCommentId(undefined);
                  editor.tf.reset();
                  editor.tf.focus();
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
          <Toolbar className="no-scrollbar gap-x-1 border-y p-1">
            <MediaToolbarButton nodeType={ImagePlugin.key} />
            <LinkToolbarButton />
          </Toolbar>
          <Editor
            placeholder={t('comment.placeholder')}
            size={'sm'}
            focusRing={false}
            className="h-24 rounded-none border-none outline-none focus:outline-none"
            variant={'ghost'}
            disabled={!permission['record|comment']}
            onCompositionStart={() => {
              setComposition(true);
            }}
            onCompositionEnd={() => {
              setComposition(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !composition) {
                event.preventDefault();
                submit();
              }
              if (event.key === 'Escape') {
                editor.tf.blur();
                event.stopPropagation();
                modalElementRef?.current?.focus();
              }
            }}
          />
        </Plate>
      </div>
    </TooltipProvider>
  );
};
