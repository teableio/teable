import { debounce } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import { useDropArea } from 'react-use';

interface IUseDragFileProps {
  event?: {
    onDrop?: (files: File[]) => void;
    onPaste?: (files: File[], event: Event) => void;
  };
  options?: {
    debounceTime?: number;
  };
}

/** Marks a file paste as consumed so an ancestor editor cannot process it again. */
export const consumeFilePaste = (
  event: Event,
  files: File[],
  onChange?: (files: File[]) => void
) => {
  if (!files.length) return;
  event.stopPropagation();
  onChange?.(files);
};

export const useDragFile = (props: IUseDragFileProps = {}) => {
  const { event, options } = props;
  const { onDrop, onPaste } = event || {};
  const { debounceTime = 30 } = options || {};
  const [hasOver, setHasOver] = useState(false);
  const [bound, { over }] = useDropArea({
    onFiles: (files, event) => {
      if (onDrop && event.type === 'drop') onDrop(files);
      if (onPaste && event.type === 'paste') onPaste(files, event);
    },
  });
  const [dragFileEnter, setDragFileEnter] = useState<boolean>(false);

  const updateDragFileEnter = useMemo(() => {
    return debounce(setDragFileEnter, debounceTime);
  }, [debounceTime]);

  useEffect(() => {
    const isFileDrag = (e: DragEvent) => e.dataTransfer?.types?.includes('Files') ?? false;

    const onDragOverOrEnter = (e: DragEvent) => {
      if (isFileDrag(e)) {
        e.preventDefault();
        setHasOver(true);
      }
    };
    const onDragLeaveOrDrop = () => setHasOver(false);

    document.addEventListener('dragenter', onDragOverOrEnter);
    document.addEventListener('dragover', onDragOverOrEnter);
    document.addEventListener('dragleave', onDragLeaveOrDrop);
    document.addEventListener('drop', onDragLeaveOrDrop);

    return () => {
      document.removeEventListener('dragenter', onDragOverOrEnter);
      document.removeEventListener('dragover', onDragOverOrEnter);
      document.removeEventListener('dragleave', onDragLeaveOrDrop);
      document.removeEventListener('drop', onDragLeaveOrDrop);
    };
  }, []);

  useEffect(() => {
    updateDragFileEnter(hasOver);
    return () => updateDragFileEnter.cancel();
  }, [updateDragFileEnter, hasOver]);
  return {
    over,
    dragFileEnter,
    bound,
  };
};
