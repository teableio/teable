import { Textarea } from '@teable/ui-lib';
import { useEffect, useRef, useState } from 'react';
import { MarkdownPreview } from './MarkDownPreview';

interface IMarkDownEditorProps {
  value?: string;
  autoFocusLastNode?: boolean;
  onChange: (value: string) => void;
}

export const MarkDownEditor = (props: IMarkDownEditorProps) => {
  const { value, onChange, autoFocusLastNode } = props;
  const [markdownValue, setMarkdownValue] = useState(value || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!autoFocusLastNode || !textarea) return;
    // continue writing where the description ends
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [autoFocusLastNode]);

  return (
    <div className="flex flex-1 gap-0.5 overflow-hidden rounded-sm border">
      <Textarea
        ref={textareaRef}
        className="min-h-20 w-1/2 resize-none rounded-none border-none bg-secondary px-3 py-2 hover:border-none focus-visible:border-none dark:bg-secondary"
        value={markdownValue}
        onChange={(e) => {
          setMarkdownValue(e.target.value);
          onChange(e.target.value);
        }}
      />
      <MarkdownPreview className="w-1/2 overflow-auto">{markdownValue}</MarkdownPreview>
    </div>
  );
};
