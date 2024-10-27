import { RotateCw, ZoomIn, ZoomOut, RefreshCcw } from '@teable/icons';
import { useEffect, useState } from 'react';
import type { IFileItemInner } from '../FilePreviewContext';
interface IImagePreviewProps extends IFileItemInner {}

export const ImagePreview = (props: IImagePreviewProps) => {
  const { src, name } = props;
  const [scale, setScale] = useState(1);
  const [rotate, setRotate] = useState(0);

  const [position, setPosition] = useState({
    oldX: 0,
    oldY: 0,
    x: 0,
    y: 0,
  });
  const [isPanning, setPanning] = useState(false);

  const handleZoomIn = () => {
    setPosition({
      ...position,
      x: (position.x -= 135.5),
      y: (position.y -= 65.6),
    });
    setScale(scale + 0.65);
  };

  const handleZoomOut = () => {
    if (scale <= 0.35) return;
    setScale(scale - 0.65);
  };
  const handleReset = () => {
    setScale(1);
    setRotate(0);
    setPosition({
      oldX: 0,
      oldY: 0,
      x: 0,
      y: 0,
    });
  };
  const handleRotate = () => {
    setRotate(rotate + 30);
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    e.preventDefault();
    if (scale > 1) {
      setPanning(true);
      setPosition({
        ...position,
        oldX: e.clientX,
        oldY: e.clientY,
      });
    }
  };

  useEffect(() => {
    const mouseup = () => {
      setPanning(false);
    };

    const mousemove = (event: MouseEvent) => {
      if (isPanning) {
        if (position.x == 0) {
          return;
        }
        setPosition({
          ...position,
          x: position.x + event.clientX - position.oldX,
          y: position.y + event.clientY - position.oldY,
          oldX: event.clientX,
          oldY: event.clientY,
        });
      }
    };

    window.addEventListener('mouseup', mouseup);
    window.addEventListener('mousemove', mousemove);

    return () => {
      window.removeEventListener('mouseup', mouseup);
      window.removeEventListener('mousemove', mousemove);
    };
  });

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="flex-col flex h-full justify-center items-center overflow-hidden"
      style={{
        cursor: `${scale > 1 ? 'grabbing' : 'auto'}`,
      }}
      onMouseDown={(e) => onMouseDown(e)}
    >
      <div
        className="img-box"
        style={{ transform: `translate(${position.x}px,${position.y}px) scale(${scale})` }}
      >
        <img
          className="max-h-2xl max-w-2xl items-center"
          src={src}
          alt={name}
          style={{
            transform: `rotate(${rotate}deg)`,
          }}
          draggable={false}
        />
      </div>
      <div className=" absolute bottom-0  right-30 justify-center">
        {/* zoomin */}
        <button className=" p-2 rounded-md hover:bg-black/40" onClick={handleZoomIn}>
          <ZoomIn className="text-xl" />
        </button>
        {/* zoomout */}
        <button className=" p-2 rounded-md hover:bg-black/40" onClick={handleZoomOut}>
          <ZoomOut className="text-xl" />
        </button>
        {/* rotate */}
        <button className=" p-2 rounded-md hover:bg-black/40" onClick={handleRotate}>
          <RotateCw className="text-xl" />
        </button>
        {/* reset */}
        <button className="p-2 rounded-md hover:bg-black/40" onClick={handleReset}>
          <RefreshCcw className="text-xl" />
        </button>
      </div>
    </div>
  );
};
