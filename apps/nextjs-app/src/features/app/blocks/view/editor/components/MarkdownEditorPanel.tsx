import { generateAttachmentId } from '@teable/core';
import { ImageIcon, Bold, Italic, Heading1, Heading2, List, ListOrdered, Link2 } from '@teable/icons';
import type { INotifyVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { AttachmentManager } from '@teable/sdk/components/editor';
import { useTranslation as useSdkTranslation } from '@teable/sdk/context/app/i18n';
import type { Record as RecordInstance, IFieldInstance } from '@teable/sdk/model';
import {
  Button,
  cn,
  ScrollArea,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFilePicker } from 'use-file-picker';
import { tableConfig } from '@/features/i18n/table.config';
import { MarkdownPreviewPanel } from './MarkdownPreviewPanel';

interface MarkdownEditorPanelProps {
  record: RecordInstance | undefined;
  field: IFieldInstance;
}

export const MarkdownEditorPanel = ({ record, field }: MarkdownEditorPanelProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { t: sdkT } = useSdkTranslation();
  const [content, setContent] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write');

  // Sync content with record field value
  useEffect(() => {
    if (record) {
      const fieldValue = record.fields[field.id] as string | undefined;
      setContent(fieldValue || '');
    } else {
      setContent('');
    }
  }, [record, field.id]);

  // Save content to record
  const saveContent = useCallback(
    async (newContent: string) => {
      if (record && newContent !== record.fields[field.id]) {
        await record.updateCell(field.id, newContent, { t: sdkT });
      }
    },
    [record, field.id, sdkT]
  );

  // Debounced save
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
    },
    []
  );

  // Save on blur
  const handleBlur = useCallback(() => {
    saveContent(content);
  }, [saveContent, content]);

  // Insert text at cursor position
  const insertText = useCallback(
    (before: string, after: string = '') => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = content.substring(start, end);
      const newText = `${content.substring(0, start)}${before}${selectedText}${after}${content.substring(end)}`;

      setContent(newText);

      // Set cursor position after the inserted text
      requestAnimationFrame(() => {
        textarea.focus();
        const newPosition = start + before.length + selectedText.length;
        textarea.setSelectionRange(newPosition, newPosition);
      });
    },
    [content]
  );

  // Upload image handler
  const uploadImage = useCallback(
    async (file: File) => {
      setIsUploading(true);
      try {
        const attachmentManager = new AttachmentManager(1);
        const attachmentResult = await new Promise<INotifyVo>((resolve, reject) => {
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
                resolve(result);
              },
              errorCallback: (_, error) => {
                reject(error);
              },
              progressCallback: () => {
                // Progress tracking can be added here if needed
              },
            }
          );
        });

        // Insert markdown image syntax
        const imageMarkdown = `![${file.name}](${attachmentResult.presignedUrl})`;
        insertText(imageMarkdown);

        // Save after inserting image
        const textarea = textareaRef.current;
        if (textarea) {
          const start = textarea.selectionStart;
          const newContent = `${content.substring(0, start)}${imageMarkdown}${content.substring(start)}`;
          setContent(newContent);
          saveContent(newContent);
        }
      } catch (error) {
        console.error('Failed to upload image:', error);
      } finally {
        setIsUploading(false);
      }
    },
    [content, insertText, saveContent]
  );

  const { openFilePicker } = useFilePicker({
    accept: ['image/*'],
    multiple: false,
    onFilesSelected: ({ plainFiles }) => {
      if (plainFiles[0]) {
        uploadImage(plainFiles[0]);
      }
    },
  });

  // Toolbar actions
  const toolbarActions = [
    { icon: Bold, label: t('table:editor.toolbar.bold'), action: () => insertText('**', '**') },
    { icon: Italic, label: t('table:editor.toolbar.italic'), action: () => insertText('_', '_') },
    { icon: Heading1, label: t('table:editor.toolbar.heading1'), action: () => insertText('# ') },
    { icon: Heading2, label: t('table:editor.toolbar.heading2'), action: () => insertText('## ') },
    { icon: List, label: t('table:editor.toolbar.bulletList'), action: () => insertText('- ') },
    {
      icon: ListOrdered,
      label: t('table:editor.toolbar.numberedList'),
      action: () => insertText('1. '),
    },
    { icon: Link2, label: t('table:editor.toolbar.link'), action: () => insertText('[', '](url)') },
    {
      icon: ImageIcon,
      label: t('table:editor.toolbar.image'),
      action: () => openFilePicker(),
      loading: isUploading,
    },
  ];

  if (!record) {
    return (
      <div className="flex flex-1 items-center justify-center bg-muted/20">
        <div className="text-center">
          <h3 className="text-lg font-medium text-muted-foreground">
            {t('table:editor.noRecordSelected.title')}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('table:editor.noRecordSelected.description')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Editor Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-sm font-medium">{record.title || t('table:editor.untitledRecord')}</h2>
        <span className="text-xs text-muted-foreground">{field.name}</span>
      </div>

      {/* Tabs for Write/Preview */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'write' | 'preview')}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between border-b px-2">
          <TabsList className="h-9 bg-transparent p-0">
            <TabsTrigger
              value="write"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              {t('table:editor.tabs.write')}
            </TabsTrigger>
            <TabsTrigger
              value="preview"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              {t('table:editor.tabs.preview')}
            </TabsTrigger>
          </TabsList>

          {/* Toolbar - only show in write mode */}
          {activeTab === 'write' && (
            <TooltipProvider>
              <div className="flex items-center gap-0.5">
                {toolbarActions.map((action, index) => (
                  <Tooltip key={action.label}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="h-7 w-7 p-0"
                        onClick={action.action}
                        disabled={action.loading}
                      >
                        <action.icon
                          className={cn('size-4', action.loading && 'animate-pulse')}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>{action.label}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
          )}
        </div>

        {/* Write Tab */}
        <TabsContent value="write" className="mt-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            onBlur={handleBlur}
            placeholder={t('table:editor.placeholder')}
            className="h-full resize-none rounded-none border-0 p-4 font-mono text-sm focus-visible:ring-0"
          />
        </TabsContent>

        {/* Preview Tab */}
        <TabsContent value="preview" className="mt-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <ScrollArea className="h-full">
            <MarkdownPreviewPanel content={content} />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
};
