/* eslint-disable jsx-a11y/click-events-have-key-events */
import { cn } from '@teable/ui-lib';
import { useMemo, useRef } from 'react';
import { useTranslation } from '../context/app/i18n';
import { useDragFile } from './upload/useDragFile';

type IAction = 'paste' | 'drop' | 'click';

interface IFileZoneProps {
  onChange?: (files: File[]) => void;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
  defaultText?: string | React.ReactNode;
  action?: IAction | IAction[];
  fileInputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}

const defaultZone = ['drop', 'click'] as IAction[];

export const FileZone = (props: IFileZoneProps) => {
  const { t } = useTranslation();

  const {
    className,
    fileInputProps,
    onChange,
    disabled,
    children,
    action = defaultZone,
    defaultText = 'File upload',
  } = props;
  const actions = useMemo(() => (Array.isArray(action) ? action : [action]), [action]);
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

  const fileInput = useRef<HTMLInputElement>(null);

  if (!dragFileEnter && children) {
    return (
      <div
        className={cn('min-h-full cursor-default p-[1px]', className)}
        tabIndex={0}
        role="button"
        {...bound}
      >
        {children}
      </div>
    );
  }

  return (
    <div className={cn('flex size-full min-h-[100px] flex-col', className)}>
      <div
        tabIndex={0}
        role="button"
        className={cn(
          'flex-1 w-full bg-foreground/5 text-foreground/60 rounded-md flex items-center justify-center text-center border border-dashed cursor-default hover:border-foreground focus:border-foreground',
          over && 'border-foreground',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        {...bound}
        onClick={() => fileInput.current?.click()}
      >
        {over ? t('editor.attachment.uploadDragOver') : defaultText}
        {actions.includes('click') && (
          <input
            multiple
            {...fileInputProps}
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => onChange?.(Array.from(e.target.files || []))}
          />
        )}
      </div>
    </div>
  );
};
