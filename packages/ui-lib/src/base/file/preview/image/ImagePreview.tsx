/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { ZoomIn, ZoomOut, RotateCw, RefreshCcw } from '@teable/icons';
import { useState, useRef, useEffect } from 'react';
import { cn } from '../../../../shadcn';
import type { IFileItemInner } from '../FilePreviewContext';

interface IImagePreviewProps extends IFileItemInner {}

export const ImagePreview = (props: IImagePreviewProps) => {
  const { src, name, onClose } = props;
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialPinchDistance, setInitialPinchDistance] = useState<number | null>(null);
  const [initialPinchScale, setInitialPinchScale] = useState(1);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset state when image changes
  useEffect(() => {
    setScale(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  }, [src]);

  // Adjust position when scale changes to keep within bounds
  useEffect(() => {
    if (scale > 1) {
      setPosition((prev) => constrainPosition(prev));
    } else {
      setPosition({ x: 0, y: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // Use ResizeObserver to efficiently monitor image dimension changes
  useEffect(() => {
    const img = imageRef.current;
    if (!img) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setImageDimensions({ width, height });
      }
    });

    resizeObserver.observe(img);

    return () => {
      resizeObserver.disconnect();
    };
  }, [src]);

  // Constrain position to prevent image from being dragged completely out of view
  const constrainPosition = (newPosition: { x: number; y: number }) => {
    if (scale <= 1 || !imageDimensions.width || !imageDimensions.height) {
      return newPosition;
    }

    // Use cached dimensions instead of getBoundingClientRect() for better performance
    const baseImageWidth = imageDimensions.width / scale; // Original displayed size before scaling
    const baseImageHeight = imageDimensions.height / scale;

    // Calculate scaled image dimensions
    const scaledWidth = baseImageWidth * scale;
    const scaledHeight = baseImageHeight * scale;

    // Calculate how much the image extends beyond the container when scaled
    const excessWidth = (scaledWidth - baseImageWidth) / 2;
    const excessHeight = (scaledHeight - baseImageHeight) / 2;

    // Allow dragging within the container bounds
    // The image can be dragged to show any part that extends beyond its original position
    const maxX = excessWidth;
    const minX = -excessWidth;
    const maxY = excessHeight;
    const minY = -excessHeight;

    return {
      x: Math.max(minX, Math.min(maxX, newPosition.x)),
      y: Math.max(minY, Math.min(maxY, newPosition.y)),
    };
  };

  // Zoom in
  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 5));
  };

  // Zoom out
  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.25, 0.25));
  };

  // Rotate clockwise
  const handleRotateClockwise = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  // Rotate counter-clockwise
  const handleRotateCounterClockwise = () => {
    setRotation((prev) => (prev - 90 + 360) % 360);
  };

  // Reset all transformations
  const handleReset = () => {
    setScale(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  };

  // Handle mouse down for dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      });
    }
  };

  // Handle mouse move for dragging
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      const newPosition = {
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      };
      setPosition(constrainPosition(newPosition));
    }
  };

  // Handle mouse up to stop dragging
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Handle mouse leave to stop dragging
  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  // Add native wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        setScale((prev) => Math.min(prev + 0.25, 5));
      } else {
        setScale((prev) => Math.max(prev - 0.25, 0.25));
      }
    };

    // Add event listener with passive: false to allow preventDefault
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Get distance between two touch points
  const getTouchDistance = (touches: React.TouchList) => {
    const touch1 = touches[0];
    const touch2 = touches[1];
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Handle touch start
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && scale > 1) {
      // Single touch - start dragging
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y,
      });
    } else if (e.touches.length === 2) {
      // Two fingers - start pinch zoom
      const distance = getTouchDistance(e.touches);
      setInitialPinchDistance(distance);
      setInitialPinchScale(scale);
      setIsDragging(false);
    }
  };

  // Handle touch move
  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && isDragging && scale > 1) {
      // Single touch - drag
      const newPosition = {
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y,
      };
      setPosition(constrainPosition(newPosition));
    } else if (e.touches.length === 2 && initialPinchDistance !== null) {
      // Two fingers - pinch zoom
      const distance = getTouchDistance(e.touches);
      const scaleChange = distance / initialPinchDistance;
      const newScale = Math.min(Math.max(initialPinchScale * scaleChange, 0.25), 5);
      setScale(newScale);
    }
  };

  // Handle touch end
  const handleTouchEnd = () => {
    setIsDragging(false);
    setInitialPinchDistance(null);
  };

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className={cn(
          'relative flex items-center justify-center w-full h-full overflow-hidden',
          scale > 1 ? 'cursor-grab' : 'cursor-default',
          isDragging && 'cursor-grabbing'
        )}
        style={{ touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose?.();
          }
        }}
      >
        <img
          ref={imageRef}
          className="max-h-full max-w-full select-none"
          src={src}
          alt={name}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
          }}
          draggable={false}
        />
      </div>

      {/* Control buttons */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 rounded-lg px-3 py-2 pointer-events-auto">
        <button
          className="p-2 rounded hover:bg-white/10 transition-colors"
          onClick={handleZoomOut}
          title="Zoom Out"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <span className="text-sm font-medium min-w-[3rem] text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          className="p-2 rounded hover:bg-white/10 transition-colors"
          onClick={handleZoomIn}
          title="Zoom In"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-white/20 mx-1" />
        <button
          className="p-2 rounded hover:bg-white/10 transition-colors"
          onClick={handleRotateCounterClockwise}
          title="Rotate Counter-Clockwise"
        >
          <RotateCw className="w-5 h-5 scale-x-[-1]" />
        </button>
        <button
          className="p-2 rounded hover:bg-white/10 transition-colors"
          onClick={handleRotateClockwise}
          title="Rotate Clockwise"
        >
          <RotateCw className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-white/20 mx-1" />
        <button
          className="p-2 rounded hover:bg-white/10 transition-colors"
          onClick={handleReset}
          title="Reset"
        >
          <RefreshCcw className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
