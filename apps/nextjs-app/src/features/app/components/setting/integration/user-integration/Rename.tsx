import { cn, Input } from '@teable/ui-lib/shadcn';
import { useEffect, useRef, useState } from 'react';

interface IRenameProps {
  name: string;
  onNameChange: (name: string) => void;
  isEditing?: boolean;
  setIsEditing: (isEditing: boolean) => void;
}

export interface IRenameRef {
  setEditingName: (name?: string) => void;
}

export const Rename = ({ name, onNameChange, isEditing, setIsEditing }: IRenameProps) => {
  const [editingName, setEditingName] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  const onChange = () => {
    if (editingName && editingName !== name) {
      onNameChange(editingName);
      return;
    }
    setIsEditing(false);
  };

  useEffect(() => {
    if (isEditing) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 200);
    }
  }, [isEditing]);

  return (
    <div className="flex flex-col items-start text-sm">
      {isEditing ? (
        <Input
          ref={inputRef}
          className={cn('h-7 text-sm', {
            hidden: !isEditing,
          })}
          value={editingName ?? name}
          onChange={(e) => setEditingName(e.target.value)}
          onBlur={() => onChange()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onChange();
            }
            if (e.key === 'Escape') {
              setIsEditing(false);
            }
            e.stopPropagation();
          }}
        />
      ) : (
        name
      )}
    </div>
  );
};
