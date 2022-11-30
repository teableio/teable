'use client';

import { useLocalstorageState } from 'rooks';
import { FileTree } from '../blocks/FileTree';

export const SideMenu = () => {
  const [currentPath, setCurrentPath] = useLocalstorageState(
    'TEABLE_SIDE_MENU_INPUT',
    ''
  );

  return (
    <>
      <input
        type="text"
        className="w-full"
        placeholder="enter absolute dir path"
        value={currentPath}
        onChange={(e) => {
          setCurrentPath(e.target.value);
        }}
      />
      <FileTree rootPath={currentPath} />
    </>
  );
};
