import type { IViewInstance } from '@teable/sdk/model';
import { Input } from '@teable/ui-lib/shadcn/ui/input';
import { useEffect, useRef } from 'react';

/**
 * Renames a view in place, for the view tab and the view list's rows: Enter or leaving the field
 * saves a changed name, Escape keeps the old one. Keys and clicks stay in the field, so the list or
 * the button around it doesn't act on them.
 */
export const ViewNameInput = ({
  view,
  className,
  onDone,
}: {
  view: IViewInstance;
  className?: string;
  onDone: () => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter and Escape finish before the field unmounts, which can still fire a blur.
  const doneRef = useRef(false);

  // Focus once the menu that started the rename has closed and handed focus back.
  useEffect(() => {
    const timeout = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 200);
    return () => clearTimeout(timeout);
  }, []);

  const finish = (value?: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (value && value !== view.name) view.updateName(value);
    onDone();
  };

  return (
    <Input
      ref={inputRef}
      type="text"
      placeholder="name"
      defaultValue={view.name}
      className={className}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value);
        if (e.key === 'Escape') finish();
      }}
    />
  );
};
