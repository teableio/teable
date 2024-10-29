import { SingleLineTextDisplayType } from '@teable/core';
import type { ISingleLineTextFieldOptions } from '@teable/core';
import { Link, Mail, Phone } from '@teable/icons';
import { Button, Input, cn } from '@teable/ui-lib';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { ICellEditor, IEditorRef } from '../type';
import { onMixedTextClick } from './utils';

interface ITextEditor extends ICellEditor<string | null> {
  options: ISingleLineTextFieldOptions;
}

const TextEditorBase: ForwardRefRenderFunction<IEditorRef<string>, ITextEditor> = (props, ref) => {
  const { value, options, onChange, className, readonly, style, saveOnBlur = true } = props;
  const [text, setText] = useState<string>(value || '');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const showAs = options.showAs;

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setValue: (value?: string) => setText(value || ''),
    saveValue,
  }));

  const onChangeInner = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  };

  const saveValue = () => {
    onChange?.(text ? text.trim() : null);
  };

  const onJump = (type: SingleLineTextDisplayType) => {
    onMixedTextClick(type, text);
  };

  const getIcon = (type: SingleLineTextDisplayType) => {
    switch (type) {
      case SingleLineTextDisplayType.Url:
        return <Link className="size-4" />;
      case SingleLineTextDisplayType.Email:
        return <Mail className="size-4" />;
      case SingleLineTextDisplayType.Phone:
        return <Phone className="size-4" />;
      default:
        return null;
    }
  };

  return (
    <div className="flex w-full items-center space-x-2">
      <Input
        ref={inputRef}
        style={style}
        className={cn('h-10 sm:h-8', className)}
        value={text}
        onChange={onChangeInner}
        onBlur={() => saveOnBlur && saveValue()}
        readOnly={readonly}
      />
      {showAs && (
        <Button variant="outline" size="sm" className="px-2" onClick={() => onJump(showAs.type)}>
          {getIcon(showAs.type)}
        </Button>
      )}
    </div>
  );
};

export const TextEditor = forwardRef(TextEditorBase);
