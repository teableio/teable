/* eslint-disable jsx-a11y/no-static-element-interactions */
import { noop } from 'lodash';
import type { ForwardRefRenderFunction } from 'react';
import { useImperativeHandle, forwardRef, useRef, useState } from 'react';
import type { IRatingCell } from '../../renderers';
import { isNumberKey } from '../../utils';
import type { IEditorRef, IEditorProps } from './EditorContainer';

const RatingEditorBase: ForwardRefRenderFunction<
  IEditorRef<IRatingCell>,
  IEditorProps<IRatingCell>
> = (props, ref) => {
  const { cell, onChange } = props;
  const focusRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState<number | null>(cell.data);
  const [lastTime, setLastTime] = useState(0);

  useImperativeHandle(ref, () => ({
    focus: () => focusRef.current?.focus(),
    setValue: (v: number) => setValue(v),
    saveValue: noop,
  }));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey) return;
    if (isNumberKey(e.keyCode)) {
      const currentTime = Date.now();
      let newValue: number | null = Number(e.key);
      if (value === 1 && newValue === 0 && currentTime - lastTime <= 500) {
        newValue = Number(`${value}${newValue}`);
      } else {
        newValue =
          newValue === value || newValue === 0 || Number.isNaN(newValue)
            ? null
            : Math.min(newValue, cell.max);
      }
      setValue(newValue);
      onChange?.(newValue);
      setLastTime(currentTime);
    }
  };

  return (
    <div onKeyDown={onKeyDown} className="size-0">
      <input ref={focusRef} className="size-0 border-none p-0 shadow-none outline-none" />
    </div>
  );
};

export const RatingEditor = forwardRef(RatingEditorBase);
