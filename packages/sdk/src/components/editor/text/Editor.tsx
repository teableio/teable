import { SingleLineTextDisplayType, getTextActionType } from '@teable/core';
import type { ISingleLineTextFieldOptions } from '@teable/core';
import { Link, Mail, Phone } from '@teable/icons';
import { Button, Input, Popover, PopoverContent, PopoverTrigger, cn } from '@teable/ui-lib';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { findUrls } from '../../../utils/find-urls';
import { toUrlHref } from '../../../utils/url';
import type { ICellEditor, IEditorRef } from '../type';
import { onMixedTextClick } from './utils';

interface ITextEditor extends ICellEditor<string | null> {
  options: ISingleLineTextFieldOptions;
}

const TextEditorBase: ForwardRefRenderFunction<IEditorRef<string>, ITextEditor> = (props, ref) => {
  const { value, options, onChange, className, readonly, style, saveOnBlur = true } = props;
  const [text, setText] = useState<string>(value || '');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const actionType = getTextActionType(options.showAs);
  const urls = actionType ? [] : findUrls(text);

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

  return (
    <div className="flex w-full items-center space-x-2 rtl:space-x-reverse">
      <Input
        ref={inputRef}
        style={style}
        className={cn('h-8', className)}
        value={text}
        onChange={onChangeInner}
        onBlur={() => saveOnBlur && saveValue()}
        readOnly={readonly}
      />
      {actionType && (
        <Button
          variant="outline"
          size="sm"
          className="px-2"
          onClick={() => onMixedTextClick(actionType, text)}
        >
          {actionType === SingleLineTextDisplayType.Email ? (
            <Mail className="size-4" />
          ) : (
            <Phone className="size-4" />
          )}
        </Button>
      )}
      {urls.length > 0 && (
        // Not modal: a nested modal popover traps expand-record pointer events (T7102)
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="px-2">
              <Link className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-auto max-w-80 flex-col gap-0.5 p-1">
            {urls.map(({ start, url }) => (
              <a
                key={start}
                href={toUrlHref(url)}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate rounded-sm px-2 py-1.5 text-sm text-violet-500 hover:bg-accent hover:underline"
              >
                {url}
              </a>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};

export const TextEditor = forwardRef(TextEditorBase);
