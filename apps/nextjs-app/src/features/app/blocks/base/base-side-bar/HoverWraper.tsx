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

  const mouseEnterHandler = () => {
    setHover(true);
  };

  const mouseOutHandler = () => {
    setHover(false);
  };

  return (
    <div>
      <div onMouseEnter={() => mouseEnterHandler()} className="z-[20]">
        {trigger}
      </div>
      <div className={classNames('fixed z-50 flex h-full top-0', hover ? 'w-full' : 'w-auto')}>
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
