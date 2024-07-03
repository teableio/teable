import React, { type FC } from 'react';

interface ISpaceSettingContentProps {
  children: React.ReactElement;
}

export const SpaceSpaceSettingContent: FC<ISpaceSettingContentProps> = (
  props: ISpaceSettingContentProps
) => {
  const { children } = props;
  return (
    <div className="h-full flex-1 overflow-y-auto overflow-x-hidden pl-8 pt-12">{children}</div>
  );
};
