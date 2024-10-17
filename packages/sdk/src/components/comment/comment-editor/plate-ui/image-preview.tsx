import { cn, createPrimitiveComponent } from '@udecode/cn';
import {
  PreviewImage,
  useImagePreview,
  useImagePreviewState,
  useScaleInput,
  useScaleInputState,
} from '@udecode/plate-media/react';
import { cva } from 'class-variance-authority';

import { Icons } from './icons';

const toolButtonVariants = cva('rounded bg-[rgba(0,0,0,0.5)] px-1', {
  defaultVariants: {
    variant: 'default',
  },
  variants: {
    variant: {
      default: 'text-white',
      disabled: 'cursor-not-allowed text-gray-400',
    },
  },
});

const ScaleInput = createPrimitiveComponent('input')({
  propsHook: useScaleInput,
  stateHook: useScaleInputState,
});

const SCROLL_SPEED = 4;

export const ImagePreview = () => {
  const state = useImagePreviewState({ scrollSpeed: SCROLL_SPEED });

  const {
    closeProps,
    currentUrlIndex,
    maskLayerProps,
    nextDisabled,
    nextProps,
    prevDisabled,
    prevProps,
    scaleTextProps,
    zommOutProps,
    zoomInDisabled,
    zoomInProps,
    zoomOutDisabled,
  } = useImagePreview(state);

  const { isOpen, scale } = state;

  return (
    <div
      className={cn('fixed left-0 top-0 z-50 bottom-0 right-0', !isOpen && 'hidden')}
      {...maskLayerProps}
    >
      <div className="absolute inset-0 size-full bg-black opacity-30"></div>
      <div className="absolute inset-0 size-full bg-black opacity-30"></div>
      <div className="absolute inset-0 flex items-center justify-center ">
        <div className="relative flex max-h-screen w-full items-center">
          <PreviewImage
            className={cn(
              'mx-auto block max-h-[calc(100vh-4rem)] w-auto object-contain transition-transform'
            )}
          />
          <div
            tabIndex={0}
            role="button"
            onKeyDown={(e) => e.stopPropagation()}
            className="absolute bottom-0 left-1/2 z-40 flex w-fit -translate-x-1/2 justify-center gap-4 p-2 text-center text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex gap-1 ">
              <button
                {...prevProps}
                className={cn(
                  toolButtonVariants({
                    variant: prevDisabled ? 'disabled' : 'default',
                  })
                )}
                type="button"
              >
                <Icons.arrowLeft className="size-5" />
              </button>
              {(currentUrlIndex ?? 0) + 1}
              <button
                {...nextProps}
                className={cn(
                  toolButtonVariants({
                    variant: nextDisabled ? 'disabled' : 'default',
                  })
                )}
                type="button"
              >
                <Icons.arrowRight className="size-5" />
              </button>
            </div>
            <div className="flex ">
              <button
                className={cn(
                  toolButtonVariants({
                    variant: zoomOutDisabled ? 'disabled' : 'default',
                  })
                )}
                {...zommOutProps}
                type="button"
              >
                <Icons.minus className="size-4" />
              </button>
              <div className="mx-px">
                {state.isEditingScale ? (
                  <>
                    <ScaleInput className="w-10 rounded px-1 text-slate-500 outline" />{' '}
                    <span>%</span>
                  </>
                ) : (
                  <span {...scaleTextProps}>{scale * 100 + '%'}</span>
                )}
              </div>
              <button
                className={cn(
                  toolButtonVariants({
                    variant: zoomInDisabled ? 'disabled' : 'default',
                  })
                )}
                {...zoomInProps}
                type="button"
              >
                <Icons.add className="size-4" />
              </button>
            </div>
            {/* TODO: downLoad the image */}
            {/* <button className={cn(toolButtonVariants())} type="button">
              <Icons.downLoad className="size-4" />
            </button> */}
            <button {...closeProps} className={cn(toolButtonVariants())} type="button">
              <Icons.close className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
