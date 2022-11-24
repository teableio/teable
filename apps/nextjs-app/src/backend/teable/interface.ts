export type FileNode = {
  name: string;
  path: string;
  isDirectory?: boolean;
  type: string;
  children?: FileNode[];
};
