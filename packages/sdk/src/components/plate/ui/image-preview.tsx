'use client';

import { cn } from '@teable/ui-lib';
import { useEditorRef } from '@udecode/plate/react';
import {
  PreviewImage,
  useImagePreview,
  useImagePreviewValue,
  useScaleInput,
} from '@udecode/plate-media/react';
import { cva } from 'class-variance-authority';
import { ArrowLeft, ArrowRight, Download, Minus, Plus, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useModalRefElement } from '../../expand-record/useModalRefElement';

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

const SCROLL_SPEED = 4;

export const ImagePreview = () => {
  const editor = useEditorRef();
  const isOpen = useImagePreviewValue('isOpen', editor.id);
  const scale = useImagePreviewValue('scale');
  const isEditingScale = useImagePreviewValue('isEditingScale');
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
  } = useImagePreview({ scrollSpeed: SCROLL_SPEED });

  const modalElementRef = useModalRefElement();

  if (!modalElementRef.current) return null;

  return createPortal(
    <div
      className={cn('fixed top-0 left-0 z-50 size-full select-none', !isOpen && 'hidden')}
      onContextMenu={(e) => e.stopPropagation()}
      {...maskLayerProps}
    >
      <div className="absolute inset-0 size-full bg-black opacity-30"></div>
      <div className="absolute inset-0 size-full bg-black opacity-30"></div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex max-h-screen w-full items-center">
          <PreviewImage
            className={cn(
              'mx-auto block max-h-[calc(100vh-4rem)] w-auto object-contain transition-transform'
            )}
          />
          <div
            className="absolute bottom-0 left-1/2 z-40 flex w-fit -translate-x-1/2 justify-center gap-4 p-2 text-center text-white"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
            role="button"
            tabIndex={0}
          >
            <div className="flex gap-1">
              <button
                {...prevProps}
                className={cn(
                  toolButtonVariants({
                    variant: prevDisabled ? 'disabled' : 'default',
                  })
                )}
                type="button"
              >
                <ArrowLeft />
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
                <ArrowRight />
              </button>
            </div>
            <div className="flex">
              <button
                className={cn(
                  toolButtonVariants({
                    variant: zoomOutDisabled ? 'disabled' : 'default',
                  })
                )}
                {...zommOutProps}
                type="button"
              >
                <Minus className="size-4" />
              </button>
              <div className="mx-px">
                {isEditingScale ? (
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
                <Plus className="size-4" />
              </button>
            </div>
            {/* TODO: downLoad the image */}
            <button className={cn(toolButtonVariants())} type="button">
              <Download className="size-4" />
            </button>
            <button {...closeProps} className={cn(toolButtonVariants())} type="button">
              <X className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    modalElementRef.current
  );
};

export function ScaleInput(props: React.ComponentProps<'input'>) {
  const { props: scaleInputProps, ref } = useScaleInput();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <input {...scaleInputProps} {...props} ref={ref as any} />;
}
