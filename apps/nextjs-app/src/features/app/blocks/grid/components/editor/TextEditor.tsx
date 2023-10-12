import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import type { ChangeEvent, ForwardRefRenderFunction } from 'react';
import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import type { INumberCell, ITextCell } from '../../renderers';
import { CellType } from '../../renderers';
import type { IEditorRef, IEditorProps } from './EditorContainer';

const TextEditorBase: ForwardRefRenderFunction<
  IEditorRef<ITextCell | INumberCell>,
  IEditorProps<ITextCell | INumberCell>
> = (props, ref) => {
  const { cell, onChange, style } = props;
  const { displayData, type } = cell;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValueInner] = useState(displayData);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setValue: (value: string | number | null | undefined) => setValueInner(String(value ?? '')),
    saveValue,
  }));

  const saveValue = () => {
    if (value === displayData) return;
    onChange?.(type === CellType.Number ? Number(value) : value);
  };

  const onChangeInner = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setValueInner(value);
  };

  return (
    <Input
      ref={inputRef}
      style={style}
      value={value}
      width={'100%'}
      height={'100%'}
      className="h-full w-full border-2 px-2 shadow-none focus-visible:ring-transparent"
      onChange={onChangeInner}
    />
  );
};

export const TextEditor = forwardRef(TextEditorBase);
