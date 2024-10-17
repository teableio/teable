import { useQuery } from '@tanstack/react-query';
import { getCommentAttachmentUrl } from '@teable/openapi';
import { cn, withRef } from '@udecode/cn';
import { PlateElement, withHOC } from '@udecode/plate-common/react';
import { Image, useMediaState } from '@udecode/plate-media/react';
import { ResizableProvider } from '@udecode/plate-resizable';
import React, { useMemo } from 'react';
import { ReactQueryKeys } from '../../../../config';
import { useTableId } from '../../../../hooks';
import { useRecordId } from '../../hooks';
import { useCommentStore } from '../../useCommentStore';
import type { TImageElement } from '../plugin/image-plugin/ImagePlugin';

import { Resizable, ResizeHandle, mediaResizeHandleVariants } from './resizable';

interface IImageElementProps extends TImageElement {
  path: string;
}

export const ImageElement = withHOC(
  ResizableProvider,
  withRef<typeof PlateElement>(({ children, className, nodeProps, ...props }, ref) => {
    const { align = 'center', focused, readOnly, selected } = useMediaState();
    const tableId = useTableId();
    const recordId = useRecordId();
    const element = props.element as IImageElementProps;
    const { path, url } = element;

    const { attachmentPresignedUrls, setAttachmentPresignedUrls } = useCommentStore();

    const { data: imageData } = useQuery({
      queryKey: ReactQueryKeys.commentAttachment(tableId!, recordId!, path),
      queryFn: () => getCommentAttachmentUrl(tableId!, recordId!, path).then(({ data }) => data),
      enabled: !attachmentPresignedUrls[path as string] && !!tableId && !!recordId,
    });

    if (imageData && !attachmentPresignedUrls[path as string]) {
      setAttachmentPresignedUrls(path, imageData);
    }

    const mergedProps = useMemo(
      () => ({
        ...props,
        element: {
          ...props.element,
          url: url ?? imageData ?? attachmentPresignedUrls[path as string],
        },
      }),
      [imageData, path, props, attachmentPresignedUrls, url]
    );

    return (
      <PlateElement className={cn('py-2.5', className)} ref={ref} {...mergedProps}>
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
              alt=""
              className={cn(
                'block w-full max-w-full cursor-pointer object-cover px-0',
                'rounded-sm',
                focused && selected && 'ring-2 ring-ring ring-offset-2'
              )}
              src={mergedProps.element.url as string}
              {...nodeProps}
            />
            <ResizeHandle
              className={mediaResizeHandleVariants({
                direction: 'right',
              })}
              options={{ direction: 'right' }}
            />
          </Resizable>
        </figure>

        {children}
      </PlateElement>
    );
  })
);
