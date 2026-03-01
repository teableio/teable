import { generateAttachmentId } from '@teable/core';
import type { INotifyVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { cn, Button, Separator } from '@teable/ui-lib';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link,
  Image,
  Eye,
  EyeOff,
  Minus,
  CheckSquare,
  Table,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { AttachmentManager } from '../attachment/AttachmentManager';
import { MarkdownPreview } from '../../markdown-editor/MarkDownPreview';

interface IMarkdownWYSIWYGEditorProps {
  value: string;
  onChange: (value: string) => void;
  readonly?: boolean;
  className?: string;
  minHeight?: string;
  maxHeight?: string;
  placeholder?: string;
}

interface IToolbarButton {
  icon: React.ReactNode;
  title: string;
  action: () => void;
  isActive?: boolean;
}

export const MarkdownWYSIWYGEditor = (props: IMarkdownWYSIWYGEditorProps) => {
  const {
    value,
    onChange,
    readonly = false,
    className,
    minHeight = '300px',
    maxHeight = '100%',
    placeholder = 'Write your content here...',
  } = props;

  const [showPreview, setShowPreview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getSelectionInfo = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return { start: 0, end: 0, selectedText: '' };
    return {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      selectedText: value.substring(textarea.selectionStart, textarea.selectionEnd),
    };
  }, [value]);

  const insertText = useCallback(
    (before: string, after: string = '', placeholder: string = '') => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { start, end, selectedText } = getSelectionInfo();
      const textToInsert = selectedText || placeholder;
      const newText =
        value.substring(0, start) + before + textToInsert + after + value.substring(end);
      onChange(newText);

      setTimeout(() => {
        textarea.focus();
        const newCursorPos = start + before.length + textToInsert.length;
        textarea.setSelectionRange(
          start + before.length,
          selectedText ? newCursorPos : newCursorPos
        );
      }, 0);
    },
    [value, onChange, getSelectionInfo]
  );

  const insertAtLineStart = useCallback(
    (prefix: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { start, end } = getSelectionInfo();
      const lines = value.split('\n');
      let charCount = 0;
      let startLine = 0;
      let endLine = 0;

      for (let i = 0; i < lines.length; i++) {
        if (charCount + lines[i].length >= start && startLine === 0) {
          startLine = i;
        }
        if (charCount + lines[i].length >= end) {
          endLine = i;
          break;
        }
        charCount += lines[i].length + 1;
      }

      for (let i = startLine; i <= endLine; i++) {
        lines[i] = prefix + lines[i];
      }

      onChange(lines.join('\n'));
      setTimeout(() => textarea.focus(), 0);
    },
    [value, onChange, getSelectionInfo]
  );

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
            UploadType.Table,
            {
              successCallback: (_, result) => {
                resolve(result);
              },
              errorCallback: (_, error) => {
                reject(error);
              },
            }
          );
        });

        const imageUrl = attachmentResult.presignedUrl;
        const imageName = file.name;
        insertText(`![${imageName}](`, ')', imageUrl);
      } catch (error) {
        console.error('Failed to upload image:', error);
      } finally {
        setIsUploading(false);
      }
    },
    [insertText]
  );

  const handleImageUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && file.type.startsWith('image/')) {
        uploadImage(file);
      }
      e.target.value = '';
    },
    [uploadImage]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            uploadImage(file);
          }
          return;
        }
      }
    },
    [uploadImage]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      const files = e.dataTransfer?.files;
      if (!files?.length) return;

      for (const file of files) {
        if (file.type.startsWith('image/')) {
          e.preventDefault();
          uploadImage(file);
          return;
        }
      }
    },
    [uploadImage]
  );

  const toolbarButtons: IToolbarButton[] = [
    {
      icon: <Bold className="size-4" />,
      title: 'Bold',
      action: () => insertText('**', '**', 'bold text'),
    },
    {
      icon: <Italic className="size-4" />,
      title: 'Italic',
      action: () => insertText('*', '*', 'italic text'),
    },
    {
      icon: <Strikethrough className="size-4" />,
      title: 'Strikethrough',
      action: () => insertText('~~', '~~', 'strikethrough'),
    },
    {
      icon: <Code className="size-4" />,
      title: 'Inline Code',
      action: () => insertText('`', '`', 'code'),
    },
  ];

  const headingButtons: IToolbarButton[] = [
    {
      icon: <Heading1 className="size-4" />,
      title: 'Heading 1',
      action: () => insertAtLineStart('# '),
    },
    {
      icon: <Heading2 className="size-4" />,
      title: 'Heading 2',
      action: () => insertAtLineStart('## '),
    },
    {
      icon: <Heading3 className="size-4" />,
      title: 'Heading 3',
      action: () => insertAtLineStart('### '),
    },
  ];

  const listButtons: IToolbarButton[] = [
    {
      icon: <List className="size-4" />,
      title: 'Bullet List',
      action: () => insertAtLineStart('- '),
    },
    {
      icon: <ListOrdered className="size-4" />,
      title: 'Numbered List',
      action: () => insertAtLineStart('1. '),
    },
    {
      icon: <CheckSquare className="size-4" />,
      title: 'Task List',
      action: () => insertAtLineStart('- [ ] '),
    },
  ];

  const blockButtons: IToolbarButton[] = [
    {
      icon: <Quote className="size-4" />,
      title: 'Quote',
      action: () => insertAtLineStart('> '),
    },
    {
      icon: <Minus className="size-4" />,
      title: 'Horizontal Rule',
      action: () => insertText('\n---\n'),
    },
    {
      icon: <Code className="size-4" />,
      title: 'Code Block',
      action: () => insertText('\n```\n', '\n```\n', 'code block'),
    },
  ];

  const insertButtons: IToolbarButton[] = [
    {
      icon: <Link className="size-4" />,
      title: 'Link',
      action: () => insertText('[', '](url)', 'link text'),
    },
    {
      icon: <Image className="size-4" />,
      title: 'Image',
      action: handleImageUpload,
    },
    {
      icon: <Table className="size-4" />,
      title: 'Table',
      action: () =>
        insertText('\n| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n'),
    },
  ];

  const renderToolbarGroup = (buttons: IToolbarButton[]) => (
    <>
      {buttons.map((button, index) => (
        <Button
          key={index}
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={button.action}
          title={button.title}
          disabled={readonly || isUploading}
        >
          {button.icon}
        </Button>
      ))}
    </>
  );

  return (
    <div className={cn('flex flex-col rounded-md border', className)}>
      {!readonly && (
        <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-2 py-1">
          {renderToolbarGroup(toolbarButtons)}
          <Separator orientation="vertical" className="mx-1 h-6" />
          {renderToolbarGroup(headingButtons)}
          <Separator orientation="vertical" className="mx-1 h-6" />
          {renderToolbarGroup(listButtons)}
          <Separator orientation="vertical" className="mx-1 h-6" />
          {renderToolbarGroup(blockButtons)}
          <Separator orientation="vertical" className="mx-1 h-6" />
          {renderToolbarGroup(insertButtons)}
          <div className="ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => setShowPreview(!showPreview)}
              title={showPreview ? 'Hide Preview' : 'Show Preview'}
            >
              {showPreview ? (
                <>
                  <EyeOff className="mr-1 size-4" />
                  <span className="text-xs">Edit</span>
                </>
              ) : (
                <>
                  <Eye className="mr-1 size-4" />
                  <span className="text-xs">Preview</span>
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex flex-1" style={{ minHeight, maxHeight }}>
        {!showPreview && (
          <div className={cn('flex-1', showPreview && 'hidden')}>
            <textarea
              ref={textareaRef}
              className={cn(
                'size-full resize-none bg-background p-4 text-sm font-mono',
                'focus:outline-none',
                'placeholder:text-muted-foreground'
              )}
              style={{ minHeight, maxHeight }}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              placeholder={placeholder}
              readOnly={readonly}
              disabled={isUploading}
            />
          </div>
        )}

        {showPreview && (
          <div
            className="flex-1 overflow-auto bg-background p-4"
            style={{ minHeight, maxHeight }}
          >
            <MarkdownPreview>{value}</MarkdownPreview>
          </div>
        )}
      </div>

      {isUploading && (
        <div className="border-t bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
          Uploading image...
        </div>
      )}
    </div>
  );
};
