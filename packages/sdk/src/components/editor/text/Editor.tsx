import { SingleLineTextDisplayType } from '@teable-group/core';
import type { ISingleLineTextFieldOptions } from '@teable-group/core';
import { Link, Mail, Phone } from '@teable-group/icons';
import { Button, Input, cn } from '@teable-group/ui-lib';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { ICellEditor, IEditorRef } from '../type';
import { onMixedTextClick } from './utils';

interface ITextEditor extends ICellEditor<string | null> {
  options: ISingleLineTextFieldOptions;
}

const TextEditorBase: ForwardRefRenderFunction<IEditorRef<string>, ITextEditor> = (props, ref) => {
  const { value, options, onChange, className, disabled, style } = props;
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
    onChange?.(text);
  };

  const onJump = (type: SingleLineTextDisplayType) => {
    onMixedTextClick(type, text);
  };

  const getIcon = (type: SingleLineTextDisplayType) => {
    switch (type) {
      case SingleLineTextDisplayType.Url:
        return <Link className="h-4 w-4" />;
      case SingleLineTextDisplayType.Email:
        return <Mail className="h-4 w-4" />;
      case SingleLineTextDisplayType.Phone:
        return <Phone className="h-4 w-4" />;
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
        onBlur={saveValue}
        disabled={disabled}
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
