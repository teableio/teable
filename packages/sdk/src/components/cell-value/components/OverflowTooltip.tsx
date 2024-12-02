import {
  Tooltip,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipProvider,
  cn,
} from '@teable/ui-lib';
import React, { useState, useRef, useEffect, useCallback } from 'react';

interface IOverflowTooltipProps {
  text?: string;
  ellipsis?: boolean;
  className?: string;
  tooltipClassName?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export const OverflowTooltip = (props: IOverflowTooltipProps) => {
  const { text = '', ellipsis = false, className, tooltipClassName, onClick } = props;
  const [isOverflow, setOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const checkOverflow = useCallback(() => {
    if (contentRef.current && ellipsis) {
      const element = contentRef.current;
      const lineHeight = parseInt(window.getComputedStyle(element).lineHeight);
      const isOverflow = element.scrollHeight > lineHeight;
      setOverflow(isOverflow);
    }
  }, [ellipsis]);

  useEffect(() => {
    const observer = new ResizeObserver(checkOverflow);

    if (contentRef.current) {
      observer.observe(contentRef.current);
    }

    return () => {
      if (contentRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        observer.unobserve(contentRef.current);
      }
    };
  }, [checkOverflow]);

  useEffect(() => {
    checkOverflow();
  }, [text, checkOverflow]);

  const Content = (
    <div
      ref={contentRef}
      className={cn(className, 'overflow-hidden whitespace-pre-wrap break-all line-clamp-6')}
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick?.();
        }
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={text}
    >
      {text}
    </div>
  );

  if (!ellipsis || !isOverflow) {
    return Content;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          onClick={(e) => {
            if (onClick) {
              e.stopPropagation();
              onClick();
            }
          }}
          className="w-full text-left"
        >
          <div
            className={cn(className, 'overflow-hidden')}
            style={{
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {text}
          </div>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent className={cn('max-w-60 break-all', tooltipClassName)}>
            <p>{text}</p>
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
};
