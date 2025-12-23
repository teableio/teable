import { ZoomIn, ZoomOut, RotateCw, RefreshCcw } from '@teable/icons';
import { useState, useRef, useEffect } from 'react';
import { cn } from '../../../../shadcn';
import type { IFileItemInner } from '../FilePreviewContext';

interface IImagePreviewProps extends IFileItemInner {}

export const ImagePreview = (props: IImagePreviewProps) => {
  const { src, name } = props;
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);

  // Reset state when image changes
  useEffect(() => {
    setScale(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  }, [src]);

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
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
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

  // Handle wheel for zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      handleZoomIn();
    } else {
      handleZoomOut();
    }
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className={cn(
          'relative flex items-center justify-center w-full h-full',
          scale > 1 ? 'cursor-grab' : 'cursor-default',
          isDragging && 'cursor-grabbing'
        )}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      >
        <img
          ref={imageRef}
          className="max-h-full max-w-full select-none pointer-events-none"
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
