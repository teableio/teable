'use client';
import * as Collapsible from '@radix-ui/react-collapsible';
import React, { useEffect } from 'react';
import { NavItem } from './NavItem';

interface IFileTreeProps {
  name: string;
  type: 'directory' | 'teable' | 'table' | 'file';
  path: string;
  isDirectory: boolean;
  children: IFileTreeProps[];
}

const getFileTree = async (path: string) => {
  const fileTreeResp = await fetch(`/api/file-tree/${path}`);
  return await fileTreeResp.json();
};

export const FileTree = (props: { rootPath?: string; tree?: IFileTreeProps }) => {
  const [open, setOpen] = React.useState(false);
  const [fileTree, setFileTree] = React.useState<IFileTreeProps | undefined>(props.tree);

  const { rootPath } = props;
  useEffect(() => {
    rootPath && getFileTree(rootPath).then((fileTree) => setFileTree(fileTree));
  }, [rootPath]);
  return (
    <>
      {fileTree && (
        <Collapsible.Root className="CollapsibleRoo" open={open}>
          <NavItem
            label={fileTree.name}
            icon={fileTree.type}
            path={fileTree.path}
            open={open}
            setOpen={setOpen}
          />
          <Collapsible.Content className="pl-3">
            <Collapsible.Trigger asChild>
              <div>
                {fileTree.children?.map((item) => (
                  <FileTree key={item.name} tree={item} />
                ))}
              </div>
            </Collapsible.Trigger>
          </Collapsible.Content>
        </Collapsible.Root>
      )}
    </>
  );
};
