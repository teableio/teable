'use client';

import { FileTree } from '../blocks/FileTree';
import { useAppStore } from '../store';

export const SideMenu = () => {
  const selectPath = useAppStore((state) => state.selectPath);

  return (
    <>
      <FileTree rootPath={selectPath} />
    </>
  );
};
