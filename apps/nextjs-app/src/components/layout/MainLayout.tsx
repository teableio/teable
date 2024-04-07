import type { FC, ReactNode } from 'react';

export const MainLayout: FC<{ children: ReactNode }> = (props) => {
  const { children } = props;
  return (
    <div
      className="flex h-screen flex-col"
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      <main>{children}</main>
    </div>
  );
};
