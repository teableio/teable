import type { FC, ReactNode } from 'react';

export const MainLayout: FC<{ children: ReactNode }> = (props) => {
  const { children } = props;
  return (
    <div className="flex h-screen flex-col">
      <main>{children}</main>
    </div>
  );
};
