import classNames from 'classnames';
import { useDropArea } from 'react-use';

export const DragAndCopy = (props: { onChange?: (files: File[]) => void; disabled?: boolean }) => {
  const { onChange, disabled } = props;

  const [bound, { over }] = useDropArea({
    onFiles: onChange,
  });

  return (
    <div className="w-full h-full flex flex-col">
      <div
        className={classNames(
          'flex-1 w-full bg-foreground/5 text-foreground/60 rounded-md flex items-center justify-center border border-dashed',
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
