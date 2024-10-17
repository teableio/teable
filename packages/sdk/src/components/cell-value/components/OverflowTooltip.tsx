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
  maxLine?: number;
  className?: string;
  tooltipClassName?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export const OverflowTooltip = (props: IOverflowTooltipProps) => {
  const { text = '', maxLine = 1, className, tooltipClassName, onClick } = props;
  const [isOverflow, setOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const checkOverflow = useCallback(() => {
    if (contentRef.current) {
      const element = contentRef.current;
      const lineHeight = parseInt(window.getComputedStyle(element).lineHeight);
      const maxHeight = lineHeight * maxLine;
      const isOverflow = element.scrollHeight > maxHeight;
      setOverflow(isOverflow);
    }
  }, [maxLine]);

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
      className={cn(className, 'overflow-hidden')}
      style={{
        display: '-webkit-box',
        WebkitLineClamp: maxLine > 99999 ? 99999 : maxLine,
        WebkitBoxOrient: 'vertical',
        wordBreak: 'break-all',
        whiteSpace: 'pre-wrap',
      }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick?.();
        }
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {text}
    </div>
  );

  if (!isOverflow) {
    return Content;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger onClick={onClick}>{Content}</TooltipTrigger>
        <TooltipPortal>
          <TooltipContent className={cn('max-w-60 break-all', tooltipClassName)}>
            <p>{text}</p>
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
};
