import { Edit } from '@teable/icons';
import { Textarea } from '@teable/ui-lib/shadcn';
import { useRef, useState } from 'react';
import Markdown from 'react-markdown';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export const MarkdownEditor = ({ value, onChange }: MarkdownEditorProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="flex items-center gap-2">
      {isEditing ? (
        <Textarea
          defaultValue={value}
          className="size-40"
          onKeyDown={(e) => {
            const newValue = (e.target as HTMLInputElement).value;
            if (e.key === 'Enter' && !e.shiftKey) {
              setIsEditing(false);
              onChange(newValue);
            }
          }}
          onBlur={(e) => {
            const newValue = e.target.value;
            if (newValue !== value) {
              onChange(newValue);
            }
            setIsEditing(false);
          }}
          ref={inputRef}
        />
      ) : (
        <Markdown>{value}</Markdown>
      )}

      <Edit
        className="size-3 shrink-0 cursor-pointer"
        onClick={() => {
          setIsEditing(true);

          setTimeout(() => {
            inputRef?.current?.focus();
          }, 100);
        }}
      />
    </div>
  );
};
