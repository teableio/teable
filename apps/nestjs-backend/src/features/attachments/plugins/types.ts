export interface IPresignParams {
  contentType: string;
  contentLength: number;
  expiresIn?: number;
  hash?: string;
  internal?: boolean;
}

export interface IPresignRes {
  token: string;
  path: string;
  url: string;
  uploadMethod: string;
  requestHeaders: Record<string, unknown>;
}

export interface IObjectMeta {
  size: number;
  mimetype: string;
  hash: string;
  url: string;
  width?: number;
  height?: number;
}

export interface ILocalFileUpload {
  path: string;
  size: number;
  mimetype: string;
}

export type IRespHeaders = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

export enum ThumbnailSize {
  SM = 'sm',
  LG = 'lg',
}

export interface IListObjectsOptions {
  /** group keys after the delimiter into `prefixes`, like S3 common prefixes */
  delimiter?: string;
}

export interface IListedObject {
  key: string;
  size: number;
  /** content version when the backend provides one (S3/minio ETag; local mtime-size) */
  etag?: string;
}

export interface IListObjectsResult {
  objects: IListedObject[];
  prefixes: string[];
}
