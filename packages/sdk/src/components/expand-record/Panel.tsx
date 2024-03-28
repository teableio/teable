import { cn } from '@teable/ui-lib';
import {
  type FC,
  type PropsWithChildren,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useLocalStorage } from 'react-use';
import { LocalStorageKeys } from '../../config/local-storage-keys';
import { useIsTouchDevice } from '../../hooks';

// eslint-disable-next-line @typescript-eslint/naming-convention
const MIN_SIZE = 300;
// eslint-disable-next-line @typescript-eslint/naming-convention
const DEFAULT_SIZE = 600;

export const Panel: FC<
  PropsWithChildren<{
    className?: string;
    visible?: boolean;
  }>
> = (props) => {
  const { children, visible, className } = props;
  const [size, setSize] = useLocalStorage<number>(
    LocalStorageKeys.ExpandRecordPanelSize,
    DEFAULT_SIZE
  );
  const [sashSize, setSashSize] = useState<number>(0);
  const sashRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<boolean>();
  const isTouchDevice = useIsTouchDevice();

  useEffect(() => {
    setSashSize(sashRef.current?.offsetWidth || 0);
  }, []);

  const right = useMemo(() => {
    return size ? size - sashSize / 2 : 0;
  }, [size, sashSize]);

  const onPointerUp = () => {
    draggingRef.current = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      e.preventDefault();
      if (draggingRef.current) {
        setSize(Math.max(document.body.clientWidth - e.pageX, MIN_SIZE));
      }
    },
    [setSize]
  );

  const onPointerDown = () => {
    draggingRef.current = true;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  if (!visible) {
    return <>{children}</>;
  }

  return (
    <div
      className={cn(
        'absolute h-full top-0 right-0 bg-background z-20',
        'before:absolute before:w-[1px] before:h-full before:top-0 before:bg-[var(--separator-border)]',
        className
      )}
      style={{ width: isTouchDevice ? '100%' : size + 'px' }}
    >
      <div
        ref={sashRef}
        className={cn(
          'absolute w-[var(--sash-size)] h-full top-0 cursor-col-resize',
          'before:absolute before:w-[var(--sash-hover-size)] before:h-full before:left-[calc(50%-(var(--sash-hover-size)/2))] before:transition-colors before:duration-100 before:ease-out before:hover:bg-[var(--focus-border)]'
        )}
        style={{
          right: right + 'px',
        }}
        onPointerDown={onPointerDown}
      />
      {children}
    </div>
  );
};
