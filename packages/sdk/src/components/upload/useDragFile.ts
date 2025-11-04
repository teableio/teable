import { debounce } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import { useDrop, useDropArea } from 'react-use';

interface IUseDragFileProps {
  event?: {
    onDrop?: (files: File[]) => void;
    onPaste?: (files: File[]) => void;
  };
  options?: {
    debounceTime?: number;
  };
}

export const useDragFile = (props: IUseDragFileProps = {}) => {
  const { event, options } = props;
  const { onDrop, onPaste } = event || {};
  const { debounceTime = 30 } = options || {};
  const { over: hasOver } = useDrop();
  const [bound, { over }] = useDropArea({
    onFiles: (files, event) => {
      if (onDrop && event.type === 'drop') onDrop(files);
      if (onPaste && event.type === 'paste') onPaste(files);
    },
  });
  const [dragFileEnter, setDragFileEnter] = useState<boolean>(false);

  const updateDragFileEnter = useMemo(() => {
    return debounce(setDragFileEnter, debounceTime);
  }, [debounceTime]);

  useEffect(() => {
    updateDragFileEnter(hasOver);
  }, [updateDragFileEnter, hasOver]);
  return {
    over,
    dragFileEnter,
    bound,
  };
};
