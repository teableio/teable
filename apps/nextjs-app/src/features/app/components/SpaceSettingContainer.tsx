import type { ReactNode } from 'react';
import { SettingStack } from './setting/SettingSection';
import { SettingTabShell } from './setting/SettingTabShell';

interface SpaceSettingContainerProps {
  title: string;
  description?: string | React.ReactElement;
  /** The page's main action, right of the title. */
  actions?: ReactNode;
  className?: string;
  children: React.ReactNode | React.ReactNode[];
}

/** A space settings page: the same frame and column as the personal ones. */
export const SpaceSettingContainer = ({
  title,
  description,
  actions,
  className,
  children,
}: SpaceSettingContainerProps) => {
  return (
    <SettingTabShell title={title} description={description} actions={actions} grouped={false}>
      <SettingStack className={className}>{children}</SettingStack>
    </SettingTabShell>
  );
};
