import classNames from 'classnames';
import { useDrop, useDropArea } from 'react-use';

interface IDragAndCopyProps {
  onChange?: (files: File[]) => void;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export const DragAndCopy = (props: IDragAndCopyProps) => {
  const { onChange, disabled, children } = props;

  const { over: hasOver } = useDrop();
  const [bound, { over }] = useDropArea({
    onFiles: onChange,
  });

  if (!hasOver && children) {
    return (
      <div className="min-h-full" tabIndex={0} role="button" {...bound}>
        {children}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div
        tabIndex={0}
        role="button"
        className={classNames(
          'flex-1 w-full bg-foreground/5 text-foreground/60 rounded-md flex items-center justify-center border border-dashed cursor-default focus:border-foreground',
          over && 'border-foreground',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        {...bound}
      >
        {over ? 'Release to upload file.' : 'Paste or drag and drop to upload here.'}
      </div>
    </div>
  );
};
