import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateAttachmentId } from '@teable/core';
import type { ICreateCommentRo, IUpdateCommentRo } from '@teable/openapi';
import { createComment, getCommentDetail, updateComment, UploadType } from '@teable/openapi';
import { Button, toast } from '@teable/ui-lib';
import { AlignPlugin } from '@udecode/plate-alignment';
import { insertNodes } from '@udecode/plate-common';
import type { TElement } from '@udecode/plate-common';
import {
  Plate,
  usePlateEditor,
  ParagraphPlugin,
  blurEditor,
  focusEditor,
} from '@udecode/plate-common/react';
import { LinkPlugin } from '@udecode/plate-link/react';
import { MentionPlugin, MentionInputPlugin } from '@udecode/plate-mention/react';
import { DeletePlugin, SelectOnBackspacePlugin } from '@udecode/plate-select';
import { SlashPlugin } from '@udecode/plate-slash-command';
import { TrailingBlockPlugin } from '@udecode/plate-trailing-block';
import { noop } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useTablePermission } from '../../../hooks';
import { AttachmentManager } from '../../editor';
import { useModalRefElement } from '../../expand-record/useModalRefElement';
import { MentionUser } from '../comment-list/node';
import { useCommentStore } from '../useCommentStore';
import { CommentQuote } from './CommentQuote';
import { Editor } from './Editor';
import {
  MentionInputElement,
  LinkElement,
  LinkFloatingToolbar,
  LinkToolbarButton,
  MentionElement,
  Toolbar,
  TooltipProvider,
  withPlaceholders,
  ImageElement,
  ImageToolbarButton,
  ParagraphElement,
  ImagePreview,
} from './plate-ui';
import type { TImageElement } from './plugin';
import { ImagePlugin } from './plugin';
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
      MentionPlugin.configure({
        options: {
          triggerPreviousCharPattern: /^$|^[\s"']$/,
        },
      }),
      LinkPlugin.extend({
        render: { afterEditable: () => <LinkFloatingToolbar /> },
      }),
      DeletePlugin,
      ImagePlugin.extend({
        options: {
          customUploadImage: (file: File) => {
            if (file.size > 5 * 1024 * 1024) {
              toast({
                variant: 'destructive',
                description: t('comment.imageSizeLimit', { size: `5MB` }),
              });
              return;
            }
            const attachmentManager = new AttachmentManager(1);
            attachmentManager.upload(
              [
                {
                  id: generateAttachmentId(),
                  instance: file,
                },
              ],
              UploadType.Comment,
              {
                successCallback: (_, result) => {
                  const text = { text: '' };
                  const image: TImageElement = {
                    children: [text],
                    type: editor.getType(ImagePlugin),
                    url: result.presignedUrl,
                    path: result.path,
                  };
                  insertNodes<TImageElement>(editor, image, {
                    nextBlock: true,
                  });
                },
              }
            );
          },
        },
        render: { afterEditable: ImagePreview },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
      SlashPlugin,
      AlignPlugin.extend({
        inject: {
          targetPlugins: [ImagePlugin.key],
        },
      }),
      TrailingBlockPlugin.configure({
        options: { type: ParagraphPlugin.key },
      }),
      SelectOnBackspacePlugin.configure({
        options: {
          query: {
            allow: [ImagePlugin.key],
          },
        },
      }),
    ],
    shouldNormalizeEditor: true,
    override: {
      components: {
        ...withPlaceholders({
          [LinkPlugin.key]: LinkElement,
          [MentionPlugin.key]: (props: React.ComponentProps<typeof MentionElement>) => (
            <MentionElement {...props} render={mentionUserRender} />
          ),
          [MentionInputPlugin.key]: MentionInputElement,
          [ImagePlugin.key]: ImageElement,
        }),
        [ParagraphPlugin.key]: ParagraphElement,
      },
    },
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
      editor?.api?.reset();
      editor.insertNodes(EditorTransform.commentValue2EditorValue(editingComment.content), {
        at: [0],
      });
    }
  }, [editingCommentId, editor, editingComment, tableId, recordId]);
  useEffect(() => {
    editorRef.current = {
      focus: () => focusEditor(editor),
      blur: () => blurEditor(editor),
    };
    setEditorRef(editorRef.current);
  }, [editor, setEditorRef]);
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
      editor?.api?.reset();
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
      editor?.api?.reset();
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
                  editor?.api?.reset();
                  focusEditor(editor);
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
          <Toolbar className="no-scrollbar border-y p-1">
            <ImageToolbarButton />
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
                blurEditor(editor);
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
