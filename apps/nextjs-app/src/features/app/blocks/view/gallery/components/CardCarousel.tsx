import type { IAttachmentCellValue } from '@teable/core';
import { isSystemFileIcon, getFileCover } from '@teable/sdk/components';
import { useAttachmentPreviewI18Map } from '@teable/sdk/components/hooks';
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
        <CarouselContent className="ml-0">
          {value.map(({ id, name, size, mimetype, presignedUrl, lgThumbnailUrl }) => {
            const isSystemFile = isSystemFileIcon(mimetype);
            const url = lgThumbnailUrl ?? getFileCover(mimetype, presignedUrl);
            return (
              <CarouselItem
                key={id}
                style={{ height: CARD_COVER_HEIGHT }}
                className="relative size-full pl-0"
              >
                <FilePreviewItem
                  key={id}
                  className="flex size-full cursor-pointer items-center justify-center"
                  src={presignedUrl || ''}
                  name={name}
                  mimetype={mimetype}
                  size={size}
                >
                  <img
                    src={url}
                    alt="card cover"
                    className={isSystemFile ? 'size-20' : 'size-full'}
                    style={{
                      objectFit: isCoverFit ? 'contain' : 'cover',
                    }}
                  />
                </FilePreviewItem>
              </CarouselItem>
            );
          })}
        </CarouselContent>
        {value.length > 1 && (
          <Fragment>
            <CarouselPrevious className="left-1 size-7" onClick={(e) => e.stopPropagation()} />
            <CarouselNext className="right-1 size-7" onClick={(e) => e.stopPropagation()} />
          </Fragment>
        )}
      </Carousel>
    </FilePreviewProvider>
  );
};
