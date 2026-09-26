import type { IAttachmentCellValue } from '@teable/core';
import { useAttachmentPreviewI18Map } from '@teable/sdk/components/hooks';
import { FileCover } from '@teable/sdk/components/upload/FileCover';
import { isImage } from '@teable/ui-lib';
import { FilePreviewProvider, FilePreviewItem } from '@teable/ui-lib/base';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from '@teable/ui-lib/shadcn';
import { Fragment } from 'react';
import { CARD_COVER_HEIGHT } from '../utils';

interface ICardCarouselProps {
  value: IAttachmentCellValue;
  isCoverFit?: boolean;
}

export const CardCarousel = (props: ICardCarouselProps) => {
  const { value, isCoverFit } = props;
  const i18nMap = useAttachmentPreviewI18Map();
  return (
    <FilePreviewProvider i18nMap={i18nMap}>
      <Carousel
        opts={{
          watchDrag: false,
          watchResize: false,
          watchSlides: false,
        }}
        className="border-b"
      >
        <CarouselContent className="ms-0">
          {value.map(({ id, name, size, mimetype, presignedUrl, lgThumbnailUrl }) => {
            return (
              <CarouselItem
                key={id}
                style={{ height: CARD_COVER_HEIGHT }}
                className="relative size-full ps-0"
              >
                <FilePreviewItem
                  key={id}
                  className="flex size-full cursor-pointer items-center justify-center"
                  src={presignedUrl || ''}
                  thumb={lgThumbnailUrl}
                  name={name}
                  mimetype={mimetype}
                  size={size}
                >
                  <FileCover
                    className="size-full"
                    style={{ objectFit: isCoverFit ? 'contain' : 'cover' }}
                    iconClassName="size-20"
                    mimetype={mimetype}
                    url={lgThumbnailUrl ?? (isImage(mimetype) ? presignedUrl : undefined)}
                    name="card cover"
                  />
                </FilePreviewItem>
              </CarouselItem>
            );
          })}
        </CarouselContent>
        {value.length > 1 && (
          <Fragment>
            <CarouselPrevious className="start-1 size-7" onClick={(e) => e.stopPropagation()} />
            <CarouselNext className="end-1 size-7" onClick={(e) => e.stopPropagation()} />
          </Fragment>
        )}
      </Carousel>
    </FilePreviewProvider>
  );
};
