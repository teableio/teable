import { Button, cn } from '@teable/ui-lib';
import {
  forwardRef,
  type ForwardRefRenderFunction,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useTranslation } from '../../../context/app/i18n';
import type { ICellEditor, IEditorRef } from '../type';

// we need to have default color for the field, because input with empty value will be invisible
// default color should not be white or black, because that color would not be visible on light or dark theme
const DEFAULT_COLOR = '#00C96F';

interface IColorEditor extends ICellEditor<string | null> {}

const ColorEditorBase: ForwardRefRenderFunction<
  IEditorRef<string>,
  IColorEditor & {
    value: string;
    saveOnChange?: boolean;
    isCellEditor?: boolean;
  }
> = (
  { value = '', onChange, saveOnBlur = true, saveOnChange = false, isCellEditor = false },
  ref
) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<string>(value || DEFAULT_COLOR);
  const [text, setText] = useState<string>(value);
  const [showButton, setShowButton] = useState<boolean>(isCellEditor && !value);
  const { t } = useTranslation();

  const updateText = (newVal: string) => {
    textRef.current = newVal;
    setText(newVal);
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.click();
    },
    setValue: (newValue?: string) => updateText(newValue?.toUpperCase() ?? ''),
    saveValue: () => onChange?.(textRef.current ? textRef.current.trim().toUpperCase() : null),
  }));

  // Native 'change' fires once when the picker is committed (closed/confirmed),
  // unlike React's onChange which fires on every 'input' event during interaction.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const handleCommit = (e: Event) => {
      const newVal = (e.target as HTMLInputElement).value;
      updateText(newVal);
      onChange?.(newVal ? newVal.trim() : null);
    };
    input.addEventListener('change', handleCommit);
    return () => input.removeEventListener('change', handleCommit);
  }, [onChange]);

  const onChangeInner = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value.toUpperCase();
    updateText(newVal);
    if (saveOnChange) {
      onChange?.(newVal ? newVal.trim() : null);
    }
  };

  const button = showButton ? (
    <Button
      className=""
      value={text}
      variant="outline"
      size={'sm'}
      onClick={() => {
        setShowButton(false);
        inputRef.current?.click();
      }}
    >
      {t('editor.color.button')}
    </Button>
  ) : null;

  return (
    <div className="relative p-[2px]">
      {button}

      <input
        ref={inputRef}
        type="color"
        value={text}
        className="block absolute size-0 left-0 top-[33px] border-0"
        onChange={onChangeInner}
        onBlur={() =>
          saveOnBlur && !saveOnChange && onChange?.(textRef.current ? textRef.current.trim() : null)
        }
      />

      <button
        className={cn(
          showButton ? 'hidden' : 'flex items-center gap-2 ',
          'bg-background px-[6px] py-[4px]'
        )}
        onClick={() => inputRef.current?.click()}
      >
        <div
          className="inline-flex items-center justify-center rounded-full p-[3px] cursor-pointer"
          style={{ backgroundColor: text }}
        >
          <span
            className="size-4 rounded-full border-2 border-background"
            style={{ backgroundColor: text }}
          />
        </div>
        <span className="text-xs flex-grow">{text}</span>
      </button>
    </div>
  );
};

export const ColorEditor = forwardRef(ColorEditorBase);
