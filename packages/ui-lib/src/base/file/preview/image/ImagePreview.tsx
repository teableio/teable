import { useState } from 'react';
import Reset from '../../../../../../icons/src/components/Reset';
import Rotate from '../../../../../../icons/src/components/Rotate';
import ZoomIn from '../../../../../../icons/src/components/ZoomIn';
import ZoomOut from '../../../../../../icons/src/components/ZoomOut';
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
    <div>
      <div className="flex">
        {/* zoomin */}
        <button
          className="absolute top-4 right-5 p-1 rounded-md hover:bg-black/40"
          onClick={handleZoomIn}
        >
          <ZoomIn className="text-xl" />
        </button>
        {/* zoomout */}
        <button
          className="absolute top-10 right-5 p-1 rounded-md hover:bg-black/40"
          onClick={handleZoomOut}
        >
          <ZoomOut className="text-xl" />
        </button>
        {/* rotate */}
        <button
          className="absolute top-16 right-5 p-1 rounded-md hover:bg-black/40"
          onClick={handleRotate}
        >
          <Rotate className="text-xl" />
        </button>
        {/* reset */}
        <button
          className="absolute top-22 right-5 p-1 rounded-md hover:bg-black/40"
          onClick={handleReset}
        >
          <Reset className="text-xl" />
        </button>
      </div>
      <img
        className="max-h-2xl max-w-2xl"
        src={src}
        alt={name}
        style={{
          transform: `scale(${scale}) rotate(${rotate}deg)`,
        }}
      />
    </div>
  );
};
