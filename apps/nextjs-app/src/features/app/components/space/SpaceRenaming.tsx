import { Input } from '@teable/ui-lib';
import React, { useEffect, useRef } from 'react';

interface SpaceRenamingProps {
  spaceName: string;
  isRenaming: boolean;
  children: React.ReactNode;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement, Element>) => void;
}

export const SpaceRenaming: React.FC<SpaceRenamingProps> = (props) => {
  const { spaceName, isRenaming, children, onChange, onBlur } = props;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 200);
    }
  }, [isRenaming]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      inputRef.current?.blur();
    }
  };

  return (
    <>
      {isRenaming ? (
        <Input
          ref={inputRef}
          className="m-0.5 h-6 flex-1"
          value={spaceName}
          onKeyDown={handleKeyDown}
          onChange={onChange}
          onBlur={onBlur}
        />
      ) : (
        children
      )}
    </>
  );
};
