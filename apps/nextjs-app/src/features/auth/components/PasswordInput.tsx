import type { InputProps } from '@teable/ui-lib/shadcn';
import {
  cn,
  Input,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { ArrowBigUp } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { authConfig } from '../../i18n/auth.config';

type IPasswordInputProps = Pick<
  InputProps,
  'id' | 'className' | 'placeholder' | 'autoComplete' | 'disabled' | 'type' | 'onChange'
> & { value: string };

export const PasswordInput = ({ value, onChange, className, ...props }: IPasswordInputProps) => {
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const hintId = useId();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const characterRef = useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [revealed, setRevealed] = useState<{ value: string; start: number; end: number }>();

  const hideCharacter = useCallback(() => {
    clearTimeout(timerRef.current);
    setRevealed(undefined);
  }, []);

  useEffect(() => {
    const updateCapsLock = (event: KeyboardEvent | MouseEvent) => {
      setCapsLock(event.getModifierState('CapsLock'));
    };
    const handleWindowBlur = () => {
      hideCharacter();
      setCapsLock(false);
    };

    // Track modifiers before focus too, for example when tabbing from the email field.
    document.addEventListener('keydown', updateCapsLock);
    document.addEventListener('keyup', updateCapsLock);
    document.addEventListener('mousedown', updateCapsLock);
    document.addEventListener('visibilitychange', handleWindowBlur);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      clearTimeout(timerRef.current);
      document.removeEventListener('keydown', updateCapsLock);
      document.removeEventListener('keyup', updateCapsLock);
      document.removeEventListener('mousedown', updateCapsLock);
      document.removeEventListener('visibilitychange', handleWindowBlur);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [hideCharacter]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    hideCharacter();
    const input = event.currentTarget;
    const { inputType, data, isComposing } = event.nativeEvent as InputEvent;
    const end = input.selectionStart;

    // Paste, autofill, deletion and IME composition always stay masked.
    if (
      input === document.activeElement &&
      inputType === 'insertText' &&
      !isComposing &&
      data &&
      Array.from(data).length === 1 &&
      end !== null &&
      input.value.slice(end - data.length, end) === data
    ) {
      setRevealed({ value: input.value, start: end - data.length, end });
      timerRef.current = setTimeout(hideCharacter, 800);
    }
    onChange?.(event);
  };

  const showCharacter = focused && !props.disabled && revealed?.value === value;
  const showCapsLock = focused && !props.disabled && capsLock;

  const syncPreviewScroll = useCallback(() => {
    const preview = previewRef.current;
    const character = characterRef.current;
    if (!preview || !character || !inputRef.current) return;

    preview.scrollLeft = inputRef.current.scrollLeft;
    // A revealed glyph can be wider than a password dot. Keep its trailing caret visible.
    preview.scrollLeft += Math.max(
      0,
      character.getBoundingClientRect().right - preview.getBoundingClientRect().right
    );
  }, []);

  useLayoutEffect(syncPreviewScroll, [syncPreviewScroll, revealed, showCharacter]);

  return (
    <div className="relative min-w-0" dir="ltr">
      <Input
        {...props}
        ref={inputRef}
        className={cn(className, 'pe-8')}
        type="password"
        dir="ltr"
        value={value}
        aria-describedby={showCapsLock ? hintId : undefined}
        style={
          showCharacter
            ? { WebkitTextFillColor: 'transparent', caretColor: 'transparent' }
            : undefined
        }
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          hideCharacter();
        }}
        onKeyDown={hideCharacter}
        onPointerDown={hideCharacter}
        onPaste={hideCharacter}
        onCompositionStart={hideCharacter}
        onScroll={syncPreviewScroll}
      />
      {showCharacter && revealed && (
        <div
          ref={previewRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 end-[33px] start-[9px] flex items-center overflow-hidden text-sm"
        >
          <span className="shrink-0 whitespace-pre">
            <span className="[-webkit-text-security:disc]">
              {'•'.repeat(Array.from(value.slice(0, revealed.start)).length)}
            </span>
            <span ref={characterRef} className="border-e border-foreground">
              {value.slice(revealed.start, revealed.end)}
            </span>
            <span className="[-webkit-text-security:disc]">
              {'•'.repeat(Array.from(value.slice(revealed.end)).length)}
            </span>
          </span>
        </div>
      )}
      {showCapsLock && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              type="button"
              tabIndex={-1}
              className="absolute inset-y-0 end-2 flex items-center text-muted-foreground"
              aria-label={t('auth:capsLockOn')}
              onMouseDown={(event) => event.preventDefault()}
            >
              <ArrowBigUp className="size-4" fill="currentColor" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent>{t('auth:capsLockOn')}</TooltipContent>
            </TooltipPortal>
          </Tooltip>
        </TooltipProvider>
      )}
      <span id={hintId} role="status" className="sr-only">
        {showCapsLock ? t('auth:capsLockOn') : null}
      </span>
    </div>
  );
};
