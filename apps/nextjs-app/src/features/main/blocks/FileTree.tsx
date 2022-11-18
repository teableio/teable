'use client';
import * as Collapsible from '@radix-ui/react-collapsible';
import React from 'react';
import { NavItem } from './NavItem';

interface IFileTreeProps {
  name: string;
  type: 'directory' | 'teable' | 'table' | 'file';
  isDirectory: boolean;
  children: IFileTreeProps[];
}

export const FileTree = (props: { tree: IFileTreeProps }) => {
  const [open, setOpen] = React.useState(false);
  const { name, type, children } = props.tree;
  console.log(props.tree);
  return (
    <Collapsible.Root className="CollapsibleRoo" open={open}>
      <NavItem label={name} icon={type} open={open} setOpen={setOpen} />
      <Collapsible.Content className="pl-3">
        <Collapsible.Trigger asChild>
          <div>
            {children?.map((item) => (
              <FileTree key={item.name} tree={item} />
            ))}
          </div>
        </Collapsible.Trigger>
      </Collapsible.Content>
    </Collapsible.Root>
  );
};
