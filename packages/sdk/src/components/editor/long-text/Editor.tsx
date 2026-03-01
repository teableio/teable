import { LongTextDisplayType } from '@teable/core';
import type { ILongTextFieldOptions } from '@teable/core';
import { cn, Button } from '@teable/ui-lib';
import { Maximize2 } from 'lucide-react';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useRef, useState, useCallback } from 'react';
import AutoSizeTextarea from 'react-textarea-autosize';
import { MarkdownPreview } from '../../markdown-editor/MarkDownPreview';
import type { ICellEditor, IEditorRef } from '../type';
import { MarkdownExpandModal } from './MarkdownExpandModal';

interface ILongTextEditor extends ICellEditor<string | null> {
  options?: ILongTextFieldOptions;
}

const LongTextEditorBase: ForwardRefRenderFunction<IEditorRef<string>, ILongTextEditor> = (
  props,
  ref
) => {
  const { value, options, onChange, className, readonly, saveOnBlur = true } = props;
  const [text, setText] = useState<string>(value || '');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const isMarkdown = options?.showAs?.type === LongTextDisplayType.Markdown;

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setValue: (value?: string) => setText(value || ''),
    saveValue,
  }));

  const onChangeInner = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  const saveValue = useCallback(() => {
    onChange?.(text || null);
  }, [onChange, text]);

  const handleModalChange = useCallback(
    (newValue: string) => {
      setText(newValue);
      onChange?.(newValue || null);
    },
    [onChange]
  );

  const handleExpandClick = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  if (isMarkdown) {
    return (
      <div className="flex w-full flex-col gap-2">
        <div className="relative">
          {text ? (
            <div
              className={cn(
                'min-h-[80px] max-h-[200px] overflow-auto rounded-md border border-input bg-background p-2 text-sm',
                className
              )}
            >
              <MarkdownPreview>{text}</MarkdownPreview>
            </div>
          ) : (
            <div
              className={cn(
                'min-h-[80px] rounded-md border border-input bg-background p-2 text-sm text-muted-foreground',
                className
              )}
            >
              Click the expand button to edit markdown content...
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExpandClick}
            className="gap-1"
            disabled={readonly}
          >
            <Maximize2 className="size-4" />
            <span>Edit Markdown</span>
          </Button>
        </div>
        <MarkdownExpandModal
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          value={text}
          onChange={handleModalChange}
          readonly={readonly}
          title="Edit Markdown Content"
        />
      </div>
    );
  }

  return (
    <AutoSizeTextarea
      ref={inputRef}
      className={cn(
        'w-full resize-none rounded-md border border-input bg-background p-2 text-sm leading-6 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className
      )}
      value={text}
      minRows={2}
      maxRows={10}
      readOnly={readonly}
      onBlur={() => saveOnBlur && saveValue()}
      onChange={onChangeInner}
    />
  );
};

export const LongTextEditor = forwardRef(LongTextEditorBase);
