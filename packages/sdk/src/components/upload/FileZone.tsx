/* eslint-disable jsx-a11y/click-events-have-key-events */
import { cn } from '@teable/ui-lib';
import { useMemo, useRef } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useDragFile } from './useDragFile';

type IAction = 'paste' | 'drop' | 'click';
const defaultZone = ['drop', 'click'] as IAction[];

export const FileZone = (props: {
  children?: React.ReactNode;
  action?: IAction | IAction[];
  hasFile?: boolean;
  onChange?: (files: File[]) => void;
  className?: string;
  zoneClassName?: string;
  defaultText?: string | React.ReactNode;
  disabled?: boolean;
}) => {
  const {
    children,
    action = defaultZone,
    onChange,
    className,
    zoneClassName,
    defaultText = 'Click to upload or paste or drag and drop here',
    disabled,
  } = props;
  const { t } = useTranslation();
  const actions = useMemo(() => (Array.isArray(action) ? action : [action]), [action]);
  const fileInput = useRef<HTMLInputElement>(null);
  const { over, bound, dragFileEnter } = useDragFile({
    event: {
      onDrop: (files: File[]) => {
        if (actions.includes('drop')) onChange?.(files);
      },
      onPaste: (files: File[]) => {
        if (actions.includes('paste')) onChange?.(files);
      },
    },
  });

  if (disabled) {
    return (
      <div className={cn('flex size-full min-h-[120px] flex-col relative gap-4', className)}>
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn('flex size-full min-h-[120px] flex-col relative gap-4', className)}
      {...bound}
    >
      <div
        tabIndex={0}
        role="button"
        className={cn(
          'w-full bg-muted text-sm text-foreground/60 rounded-md flex items-center justify-center text-center border border-dashed cursor-default hover:border-foreground focus:border-foreground',
          {
            'absolute inset-0 z-10': dragFileEnter,
          },
          zoneClassName
        )}
        onClick={() => fileInput.current?.click()}
      >
        {over ? t('editor.attachment.uploadDragOver') : defaultText}
        {actions.includes('click') && (
          <input
            multiple
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => onChange?.(Array.from(e.target.files || []))}
          />
        )}
      </div>
      {children}
    </div>
  );
};
