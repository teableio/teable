import { SetMetadata } from '@nestjs/common';

export type IResourceMeta = {
  type: 'spaceId' | 'baseId' | 'tableId';
  position: 'query' | 'params' | 'body';
};

export const RESOURCE_META = 'resourceMeta';
// eslint-disable-next-line @typescript-eslint/naming-convention
export const ResourceMeta = (type: IResourceMeta['type'], position: IResourceMeta['position']) =>
  SetMetadata(RESOURCE_META, { type, position });
