import { cn } from '@teable/ui-lib';
import { debounce } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import { useDrop, useDropArea } from 'react-use';
import { useTranslation } from '../../../../context/app/i18n';

interface IDragAndCopyProps {
  onChange?: (files: File[]) => void;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export const DragAndCopy = (props: IDragAndCopyProps) => {
  const { onChange, disabled, children } = props;
  const { t } = useTranslation();

  const { over: hasOver } = useDrop();
  const [bound, { over }] = useDropArea({
    onFiles: onChange,
  });
  const [dragFileEnter, setDragFileEnter] = useState<boolean>(false);

  const updateDragFileEnter = useMemo(() => {
    return debounce(setDragFileEnter, 30);
  }, []);

  useEffect(() => {
    updateDragFileEnter(hasOver);
  }, [updateDragFileEnter, hasOver]);

  if (!dragFileEnter && children) {
    return (
      <div className="min-h-full cursor-default" tabIndex={0} role="button" {...bound}>
        {children}
      </div>
    );
  }

  return (
    <div className="flex size-full min-h-[100px] flex-col">
      <div
        tabIndex={0}
        role="button"
        className={cn(
          'flex-1 w-full bg-foreground/5 text-foreground/60 rounded-md flex items-center justify-center border border-dashed cursor-default focus:border-foreground',
          over && 'border-foreground',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        {...bound}
      >
        {over ? t('editor.attachment.uploadDragOver') : t('editor.attachment.uploadDragDefault')}
      </div>
    </div>
  );
};
