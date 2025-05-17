'use client';

import { cn } from '@teable/ui-lib';
import type { PlateElementProps } from '@udecode/plate/react';
import { PlateElement, withHOC } from '@udecode/plate/react';
import { useDraggable } from '@udecode/plate-dnd';
import type { TImageElement } from '@udecode/plate-media';

import { Image, useMediaState } from '@udecode/plate-media/react';
import {
  ResizableProvider,
  // useResizableValue
} from '@udecode/plate-resizable';
import * as React from 'react';

import { mediaResizeHandleVariants, Resizable, ResizeHandle } from './resize-handle';

export const ImageElement = withHOC(
  ResizableProvider,
  function ImageElement(props: PlateElementProps<TImageElement>) {
    const { align = 'center', focused, readOnly, selected } = useMediaState();
    // const width = useResizableValue('width');

    const { isDragging, handleRef } = useDraggable({
      element: props.element,
    });

    return (
      <PlateElement {...props} className="py-2.5">
        <figure className="group relative m-0" contentEditable={false}>
          <Resizable
            align={align}
            options={{
              align,
              readOnly,
            }}
          >
            <ResizeHandle
              className={mediaResizeHandleVariants({ direction: 'left' })}
              options={{ direction: 'left' }}
            />
            <Image
              ref={handleRef}
              className={cn(
                'block w-full max-w-full cursor-pointer object-cover px-0',
                'rounded-sm',
                focused && selected && 'ring-2 ring-ring ring-offset-2',
                isDragging && 'opacity-50'
              )}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              alt={(props.attributes as any).alt}
            />
            <ResizeHandle
              className={mediaResizeHandleVariants({
                direction: 'right',
              })}
              options={{ direction: 'right' }}
            />
          </Resizable>
        </figure>

        {props.children}
      </PlateElement>
    );
  }
);
