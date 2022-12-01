export type IFileNode = {
  name: string;
  path: string;
  isDirectory?: boolean;
  type: string;
  children?: IFileNode[];
};
