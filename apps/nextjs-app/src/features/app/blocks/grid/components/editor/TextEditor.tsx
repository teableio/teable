import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import type { ChangeEvent, ForwardRefRenderFunction } from 'react';
import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import type { ILinkCell, INumberCell, ITextCell } from '../../renderers';
import { CellType } from '../../renderers';
import type { IEditorRef, IEditorProps } from './EditorContainer';

const TextEditorBase: ForwardRefRenderFunction<
  IEditorRef<ITextCell | INumberCell>,
  IEditorProps<ITextCell | INumberCell | ILinkCell>
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
      className="border-2 shadow-none h-full w-full focus-visible:ring-transparent px-2"
      onChange={onChangeInner}
    />
  );
};

export const TextEditor = forwardRef(TextEditorBase);
