export type FileNode = {
  name: string;
  path: string;
  isDirectory?: boolean;
  type: 'teable' | 'directory' | 'file';
  children?: FileNode[];
};
