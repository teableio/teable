import { Allotment } from 'allotment';
import React, { useState } from 'react';
import { useLocalStorage } from 'react-use';
import { useIsHydrated } from '@/lib/use-is-hydrated';
import { CloseLeftSide } from './CloseLeftSide';
import 'allotment/dist/style.css';
import { OpenLeftSide } from './OpenLeftSide';
import { OpenRightSide } from './OpenRightSide';

const minSize = 150;

export const ResizablePane: React.FC<{
  children: React.ReactNode[];
}> = ({ children }) => {
  const [size, setSize] = useLocalStorage<number[]>('side-bar-size');
  const [leftVisible, setLeftVisible] = useState<boolean>(Boolean(size?.[0] && size[0] > minSize));
  const [rightVisible, setRightVisible] = useState<boolean>(
    Boolean(size?.[2] && size[2] > minSize)
  );

  const [left, center, right] = children;
  const isHydrated = useIsHydrated();
  if (!isHydrated) {
    return (
      <>
        {left}
        {center}
        {right}
      </>
    );
  }

  return (
    <>
      {leftVisible ? (
        <CloseLeftSide
          left={size?.[0] || 0}
          onClick={() => {
            setLeftVisible(false);
          }}
        />
      ) : (
        <OpenLeftSide
          onClick={() => {
            setLeftVisible(true);
          }}
        />
      )}
      {!rightVisible && (
        <OpenRightSide
          onClick={() => {
            setRightVisible(true);
          }}
        />
      )}
      <Allotment
        minSize={0}
        onChange={(newSize) => {
          newSize[0] !== size?.[0] && setLeftVisible(newSize[0] >= minSize);
          newSize[2] !== size?.[2] && setRightVisible(newSize[2] >= minSize);
          setSize(newSize.map((s) => (s < minSize ? minSize : s)));
        }}
        defaultSizes={size}
      >
        <Allotment.Pane snap minSize={minSize} preferredSize={300} visible={leftVisible}>
          {left}
        </Allotment.Pane>
        <Allotment.Pane minSize={400}>{center}</Allotment.Pane>
        <Allotment.Pane minSize={minSize} preferredSize={100} snap visible={rightVisible}>
          {right}
        </Allotment.Pane>
      </Allotment>
    </>
  );
};
