import type { FC, ReactNode } from 'react';

export const MainLayout: FC<{ children: ReactNode }> = (props) => {
  const { children } = props;
  return (
    <div className="flex h-dvh flex-col">
      <main>{children}</main>
    </div>
  );
};
