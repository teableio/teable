import { LocalStorageKeys, useIsHydrated, useIsMobile } from '@teable-group/sdk';
import { Allotment } from 'allotment';
import React, { useState } from 'react';
import { useLocalStorage } from 'react-use';
import { SheetWraper } from '../../blocks/base/base-side-bar/SheetWraper';
import { CloseLeftSide } from './CloseLeftSide';
import 'allotment/dist/style.css';
import { OpenLeftSide } from './OpenLeftSide';
import { OpenRightSide } from './OpenRightSide';

const minSize = 150;

export const ResizablePane: React.FC<{
  children: React.ReactNode[];
}> = ({ children }) => {
  const [size, setSize] = useLocalStorage<number[]>(LocalStorageKeys.SideBarSize);
  const [left, center, right] = children;
  const isMobile = useIsMobile();

  const [leftVisible, setLeftVisible] = useState<boolean>(
    isMobile ? false : Boolean(size?.[0] && size[0] > minSize)
  );

  const [rightVisible, setRightVisible] = useState<boolean>(
    Boolean(size?.[2] && size[2] > minSize)
  );

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
      {isMobile ? (
        <SheetWraper
          open={leftVisible}
          onOpenChange={(open) => {
            setLeftVisible(open);
          }}
        >
          {left}
        </SheetWraper>
      ) : leftVisible ? (
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
      {right && !rightVisible && (
        <OpenRightSide
          onClick={() => {
            setRightVisible(true);
          }}
        />
      )}

      <Allotment
        minSize={0}
        onChange={(newSize) => {
          if (!isMobile && newSize.length > 1) {
            newSize[0] !== size?.[0] && setLeftVisible(newSize[0] >= minSize);
          }

          newSize[2] !== size?.[2] && setRightVisible(newSize[2] >= minSize);
          setSize(newSize.map((s) => (s < minSize ? minSize : s)));
        }}
        defaultSizes={size}
      >
        {!isMobile ? (
          <Allotment.Pane snap minSize={minSize} preferredSize={300} visible={leftVisible}>
            {left}
          </Allotment.Pane>
        ) : null}
        <Allotment.Pane minSize={320}>{center}</Allotment.Pane>
        {right && (
          <Allotment.Pane minSize={minSize} preferredSize={100} snap visible={rightVisible}>
            {right}
          </Allotment.Pane>
        )}
      </Allotment>
    </>
  );
};
