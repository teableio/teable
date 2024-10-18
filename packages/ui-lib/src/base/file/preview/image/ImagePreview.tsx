import { RotateCw, ZoomIn, ZoomOut, RefreshCcw } from '@teable/icons';
import { useState } from 'react';
import type { IFileItemInner } from '../FilePreviewContext';

interface IImagePreviewProps extends IFileItemInner {}

export const ImagePreview = (props: IImagePreviewProps) => {
  const { src, name } = props;
  const [scale, setScale] = useState(1);
  const [rotate, setRotate] = useState(0);
  const handleZoomIn = () => {
    console.log('handleZoomin');
    if (scale >= 1.4) return;
    setScale(scale + 0.1);
  };

  const handleZoomOut = () => {
    if (scale <= 0.6) return;
    setScale(scale - 0.1);
  };
  const handleReset = () => {
    setScale(1);
    setRotate(0);
  };
  const handleRotate = () => {
    console.log('handleRotate', rotate);
    setRotate(rotate + 30);
  };
  return (
    <div className="flex-col flex h-full justify-center items-center">
      <img
        className="max-h-2xl max-w-2xl items-center"
        src={src}
        alt={name}
        style={{
          transform: `scale(${scale}) rotate(${rotate}deg)`,
        }}
      />
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
