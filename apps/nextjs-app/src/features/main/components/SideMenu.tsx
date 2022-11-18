'use client';

import { useEffect, useState } from 'react';
import { FileTree } from '../blocks/FileTree';

const getFileTree = async (path: string) => {
  const fileTreeResp = await fetch(
    `http://localhost:3000/api/fileTree/${path}`
  );
  return await fileTreeResp.json();
};
export const SideMenu = () => {
  const [fileTree, setFileTree] = useState();
  const [currentPath, setCurrentPath] = useState('');

  useEffect(() => {
    currentPath &&
      getFileTree(currentPath).then((fileTree) => setFileTree(fileTree));
  }, [currentPath]);
  return (
    <div>
      <input
        type="text"
        className="w-full"
        placeholder="enter a absolute dir path"
        value={currentPath}
        onChange={(e) => {
          setCurrentPath(e.target.value);
        }}
      />
      <div className="prose-h6:">fav</div>
      {fileTree && <FileTree tree={fileTree} />}
    </div>
  );
};
