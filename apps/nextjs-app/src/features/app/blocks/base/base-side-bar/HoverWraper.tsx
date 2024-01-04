import classNames from 'classnames';
import React, { useState } from 'react';

interface IHoverWraperProps {
  children: React.ReactElement[];
  size: number;
}

interface IHoverWraperTag {
  children: React.ReactElement;
}

export const HoverWraper = (props: IHoverWraperProps) => {
  const { children, size = 25 } = props;
  const [trigger, content] = children;
  const [hover, setHover] = useState(false);
  const [contentVisible, setContentVisible] = useState(false);

  const mouseEnterHandler = () => {
    setHover(true);
    setContentVisible(true);
  };

  const mouseOutHandler = () => {
    setHover(false);
    setTimeout(() => {
      setContentVisible(false);
    }, 300);
  };

  return (
    <div>
      <div onMouseEnter={() => mouseEnterHandler()} className="z-10">
        {trigger}
      </div>
      {
        <div
          className={classNames(
            'fixed flex h-full top-0',
            hover ? 'z-50 w-full ' : contentVisible ? 'w-auto z-10' : 'w-auto z-0'
          )}
        >
          <div
            className={classNames('transition-[width] overflow-hidden drop-shadow-2xl border-r')}
            style={{
              width: hover ? `${size}%` : '0%',
            }}
          >
            {content}
          </div>
          <div
            onMouseEnter={() => mouseOutHandler()}
            className={classNames('flex-1', { hidden: !hover })}
          ></div>
        </div>
      }
    </div>
  );
};

export const HoverWraperTrigger = ({ children }: IHoverWraperTag) => {
  return <>{children}</>;
};

HoverWraperTrigger.displayName = 'HoverWraper.trigger';

HoverWraper.Trigger = HoverWraperTrigger;

export const HoverWraperContent = ({ children }: IHoverWraperTag) => {
  return <>{children}</>;
};

HoverWraperContent.displayName = 'HoverWraper.content';

HoverWraper.content = HoverWraperContent;
