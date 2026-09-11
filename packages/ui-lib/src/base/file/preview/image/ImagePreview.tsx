/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { ZoomIn, ZoomOut, RotateCw, RefreshCcw } from '@teable/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from '../../../../hooks/use-is-mobile';
import { cn } from '../../../../shadcn';
import type { IFileItemInner } from '../FilePreviewContext';
import { getFileIcon } from '../getFileIcon';
import { isHeic } from '../utils';

interface IImagePreviewProps extends IFileItemInner {}

interface IDimensions {
  width: number;
  height: number;
}

const MAX_SCALE = 5;
const DESKTOP_MIN_SCALE = 0.25;
const MOBILE_MIN_SCALE = 1;

const getMobileMinScale = (
  rotation: number,
  containerDimensions: IDimensions,
  imageDimensions: IDimensions
) => {
  if (
    rotation % 180 === 0 ||
    !containerDimensions.width ||
    !containerDimensions.height ||
    !imageDimensions.width ||
    !imageDimensions.height
  ) {
    return MOBILE_MIN_SCALE;
  }

  return Math.min(
    MOBILE_MIN_SCALE,
    containerDimensions.width / imageDimensions.height,
    containerDimensions.height / imageDimensions.width
  );
};

const constrainPosition = (
  position: { x: number; y: number },
  scale: number,
  rotation: number,
  containerDimensions: IDimensions,
  imageDimensions: IDimensions
) => {
  if (
    scale <= 1 ||
    !containerDimensions.width ||
    !containerDimensions.height ||
    !imageDimensions.width ||
    !imageDimensions.height
  ) {
    return { x: 0, y: 0 };
  }

  const swapsAxes = rotation % 180 !== 0;
  const rotatedWidth = swapsAxes ? imageDimensions.height : imageDimensions.width;
  const rotatedHeight = swapsAxes ? imageDimensions.width : imageDimensions.height;
  const maxX = Math.max(0, (rotatedWidth * scale - containerDimensions.width) / 2);
  const maxY = Math.max(0, (rotatedHeight * scale - containerDimensions.height) / 2);

  return {
    x: Math.max(-maxX, Math.min(maxX, position.x)),
    y: Math.max(-maxY, Math.min(maxY, position.y)),
  };
};

export const ImagePreview = (props: IImagePreviewProps) => {
  const { src, mimetype, name, onClose } = props;
  const isMobile = useIsMobile(640);
  const [renderFailed, setRenderFailed] = useState(false);
  const FileIcon = useMemo(() => getFileIcon(mimetype), [mimetype]);
  // Most browsers cannot render HEVC-encoded HEIC, so its fullscreen preview
  // is always the placeholder icon (the file stays downloadable). Other
  // images fall back to the same placeholder when they fail to load.
  const showPlaceholder = isHeic(mimetype) || renderFailed;
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialPinchDistance, setInitialPinchDistance] = useState<number | null>(null);
  const [initialPinchScale, setInitialPinchScale] = useState(1);
  const [imageDimensions, setImageDimensions] = useState<IDimensions>({ width: 0, height: 0 });
  const [containerDimensions, setContainerDimensions] = useState<IDimensions>({
    width: 0,
    height: 0,
  });
  const minScale = isMobile
    ? getMobileMinScale(rotation, containerDimensions, imageDimensions)
    : DESKTOP_MIN_SCALE;
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const positionFrameRef = useRef<number | null>(null);
  const scaleFrameRef = useRef<number | null>(null);
  const pendingPositionRef = useRef<{ x: number; y: number }>();
  const pendingScaleRef = useRef<number>();

  const cancelScheduledUpdates = useCallback(() => {
    if (positionFrameRef.current !== null) {
      cancelAnimationFrame(positionFrameRef.current);
      positionFrameRef.current = null;
    }
    if (scaleFrameRef.current !== null) {
      cancelAnimationFrame(scaleFrameRef.current);
      scaleFrameRef.current = null;
    }
    pendingPositionRef.current = undefined;
    pendingScaleRef.current = undefined;
  }, []);

  const schedulePosition = useCallback(
    (nextPosition: { x: number; y: number }) => {
      pendingPositionRef.current = constrainPosition(
        nextPosition,
        scale,
        rotation,
        containerDimensions,
        imageDimensions
      );
      if (positionFrameRef.current !== null) return;

      positionFrameRef.current = requestAnimationFrame(() => {
        if (pendingPositionRef.current) {
          setPosition(pendingPositionRef.current);
        }
        pendingPositionRef.current = undefined;
        positionFrameRef.current = null;
      });
    },
    [containerDimensions, imageDimensions, rotation, scale]
  );

  const scheduleScale = useCallback(
    (nextScale: number) => {
      pendingScaleRef.current = Math.min(Math.max(nextScale, minScale), MAX_SCALE);
      if (scaleFrameRef.current !== null) return;

      scaleFrameRef.current = requestAnimationFrame(() => {
        if (pendingScaleRef.current !== undefined) {
          setScale(pendingScaleRef.current);
        }
        pendingScaleRef.current = undefined;
        scaleFrameRef.current = null;
      });
    },
    [minScale]
  );

  useEffect(() => cancelScheduledUpdates, [cancelScheduledUpdates]);

  useEffect(() => {
    cancelScheduledUpdates();
    setScale(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
    setIsDragging(false);
    setInitialPinchDistance(null);
    setRenderFailed(false);
  }, [cancelScheduledUpdates, src]);

  useEffect(() => {
    setScale((previousScale) => Math.max(previousScale, minScale));
  }, [minScale]);

  useEffect(() => {
    setPosition((previousPosition) =>
      constrainPosition(previousPosition, scale, rotation, containerDimensions, imageDimensions)
    );
  }, [containerDimensions, imageDimensions, rotation, scale]);

  useEffect(() => {
    const container = containerRef.current;
    const image = imageRef.current;
    if (!container || !image) return;

    const updateDimensions = () => {
      setContainerDimensions({ width: container.clientWidth, height: container.clientHeight });
      setImageDimensions({ width: image.clientWidth, height: image.clientHeight });
    };
    const resizeObserver = new ResizeObserver(updateDimensions);

    updateDimensions();
    resizeObserver.observe(container);
    resizeObserver.observe(image);

    return () => resizeObserver.disconnect();
  }, [src]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.25 : -0.25;
      setScale((previousScale) => Math.min(Math.max(previousScale + delta, minScale), MAX_SCALE));
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [minScale]);

  const handleZoomIn = () => {
    setScale((previousScale) => Math.min(previousScale + 0.25, MAX_SCALE));
  };

  const handleZoomOut = () => {
    setScale((previousScale) => Math.max(previousScale - 0.25, minScale));
  };

  const handleRotateClockwise = () => {
    setRotation((previousRotation) => (previousRotation + 90) % 360);
  };

  const handleRotateCounterClockwise = () => {
    setRotation((previousRotation) => (previousRotation - 90 + 360) % 360);
  };

  const handleReset = () => {
    cancelScheduledUpdates();
    setScale(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
    setIsDragging(false);
    setInitialPinchDistance(null);
  };

  const handleMouseDown = (event: React.MouseEvent) => {
    if (scale <= 1) return;
    setIsDragging(true);
    setDragStart({
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    });
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!isDragging || scale <= 1) return;
    schedulePosition({
      x: event.clientX - dragStart.x,
      y: event.clientY - dragStart.y,
    });
  };

  const stopDragging = () => {
    setIsDragging(false);
  };

  const getTouchDistance = (touches: React.TouchList) => {
    const firstTouch = touches[0];
    const secondTouch = touches[1];
    return Math.hypot(
      secondTouch.clientX - firstTouch.clientX,
      secondTouch.clientY - firstTouch.clientY
    );
  };

  const handleTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length === 1 && scale > 1) {
      setIsDragging(true);
      setDragStart({
        x: event.touches[0].clientX - position.x,
        y: event.touches[0].clientY - position.y,
      });
      return;
    }

    if (event.touches.length === 2) {
      setInitialPinchDistance(getTouchDistance(event.touches));
      setInitialPinchScale(scale);
      setIsDragging(false);
    }
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (event.touches.length === 1 && isDragging && scale > 1) {
      schedulePosition({
        x: event.touches[0].clientX - dragStart.x,
        y: event.touches[0].clientY - dragStart.y,
      });
      return;
    }

    if (event.touches.length === 2 && initialPinchDistance !== null) {
      const scaleChange = getTouchDistance(event.touches) / initialPinchDistance;
      scheduleScale(initialPinchScale * scaleChange);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    setInitialPinchDistance(null);
  };

  const isInteracting = isDragging || initialPinchDistance !== null;

  const renderBody = () => {
    if (showPlaceholder) return <FileIcon className="text-9xl max-h-max max-w-max" />;
    return (
      <img
        ref={imageRef}
        className="max-h-full max-w-[calc(100%-2rem)] select-none sm:max-w-full"
        src={src}
        alt={name}
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
          transition: isInteracting ? 'none' : 'transform 0.2s ease-out',
        }}
        draggable={false}
        onError={() => setRenderFailed(true)}
      />
    );
  };

  return (
    <div ref={containerRef} className="relative flex size-full items-center justify-center">
      <div
        className={cn(
          'relative flex size-full items-center justify-center overflow-hidden',
          scale > 1 ? 'cursor-grab' : 'cursor-default',
          isDragging && 'cursor-grabbing'
        )}
        style={{ touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDragging}
        onMouseLeave={stopDragging}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClose?.();
          }
        }}
      >
        {renderBody()}
      </div>

      {showPlaceholder ? null : (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-black/60 px-2 py-2 sm:gap-2 sm:px-3">
          <button
            type="button"
            className="rounded p-2 transition-colors hover:bg-white/10 disabled:opacity-40"
            onClick={handleZoomOut}
            disabled={scale <= minScale}
            title="Zoom Out"
          >
            <ZoomOut className="size-5" />
          </button>
          <span className="min-w-12 text-center text-sm font-medium">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            className="rounded p-2 transition-colors hover:bg-white/10 disabled:opacity-40"
            onClick={handleZoomIn}
            disabled={scale >= MAX_SCALE}
            title="Zoom In"
          >
            <ZoomIn className="size-5" />
          </button>
          <div className="mx-0.5 h-6 w-px bg-white/20 sm:mx-1" />
          <button
            type="button"
            className="rounded p-2 transition-colors hover:bg-white/10"
            onClick={handleRotateCounterClockwise}
            title="Rotate Counter-Clockwise"
          >
            <RotateCw className="size-5 scale-x-[-1]" />
          </button>
          <button
            type="button"
            className="rounded p-2 transition-colors hover:bg-white/10"
            onClick={handleRotateClockwise}
            title="Rotate Clockwise"
          >
            <RotateCw className="size-5" />
          </button>
          <div className="mx-0.5 h-6 w-px bg-white/20 sm:mx-1" />
          <button
            type="button"
            className="rounded p-2 transition-colors hover:bg-white/10"
            onClick={handleReset}
            title="Reset"
          >
            <RefreshCcw className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
};
