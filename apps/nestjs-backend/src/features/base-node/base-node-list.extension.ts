import type { BaseNodeResourceType } from '@teable/openapi';
import type { IBaseNodeResourceInput } from './resource/base-node-resource-handler';

/** What an edition adds to one kind's resources as the node tree lists them. */
export interface IBaseNodeListExtension {
  readonly type: BaseNodeResourceType;
  /** Reads what it adds for the project, alongside the listing, and returns how to add it. */
  load(baseId: string): Promise<(resources: IBaseNodeResourceInput[]) => IBaseNodeResourceInput[]>;
}

export const BASE_NODE_LIST_EXTENSIONS = Symbol('BASE_NODE_LIST_EXTENSIONS');
