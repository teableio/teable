'use client';

import { useState } from 'react';
import { FileTree } from '../blocks/FileTree';

export const SideMenu = () => {
  const [currentPath, setCurrentPath] = useState('');

  return (
    <div>
      <input
        type="text"
        className="w-full"
        placeholder="enter absolute dir path"
        value={currentPath}
        onChange={(e) => {
          setCurrentPath(e.target.value);
        }}
      />
      <div className="prose-h6:">fav</div>
      <FileTree rootPath={currentPath} />
    </div>
  );
};
