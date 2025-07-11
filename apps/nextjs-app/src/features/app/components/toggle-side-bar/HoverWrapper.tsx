import { cn } from '@teable/ui-lib/shadcn';
import React, { useState } from 'react';
import { useSidebarStore } from '../sidebar/useSidebarStore';

interface IHoverWrapperProps {
  children: React.ReactElement[];
  size: number;
}

interface IHoverWrapperTag {
  children: React.ReactElement;
}

export const HoverWrapper = (props: IHoverWrapperProps) => {
  const { children, size = 240 } = props;
  const [trigger, content] = children;
  const [hover, setHover] = useState(false);

  const mouseEnterHandler = () => {
    setHover(true);
  };

  const mouseOutHandler = () => {
    setHover(false);
  };

  const { isVisible } = useSidebarStore();

  return (
    <div>
      <div onMouseEnter={() => mouseEnterHandler()} className="z-10">
        {trigger}
      </div>
      {
        <div
          className={cn(
            'fixed flex h-full top-0 transition-[z-index] will-change-auto',
            hover ? 'z-30 w-full' : 'w-auto z-0'
          )}
        >
          <div
            className={cn(
              'transition-[width] overflow-hidden drop-shadow-2xl border-r will-change-auto',
              {
                'border-r-0': !isVisible,
              }
            )}
            style={{
              width: hover ? `${size}px` : '0',
            }}
          >
            {content}
          </div>
          <div
            onMouseEnter={() => mouseOutHandler()}
            className={cn('flex-1', { hidden: !hover })}
          ></div>
        </div>
      }
    </div>
  );
};

export const HoverWrapperTrigger = ({ children }: IHoverWrapperTag) => {
  return <>{children}</>;
};

HoverWrapperTrigger.displayName = 'HoverWrapper.trigger';

HoverWrapper.Trigger = HoverWrapperTrigger;

export const HoverWrapperContent = ({ children }: IHoverWrapperTag) => {
  return <>{children}</>;
};

HoverWrapperContent.displayName = 'HoverWrapper.content';

HoverWrapper.content = HoverWrapperContent;
