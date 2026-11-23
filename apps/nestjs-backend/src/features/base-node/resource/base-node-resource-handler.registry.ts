import { Inject, Injectable } from '@nestjs/common';
import type { BaseNodeResourceType } from '@teable/openapi';
import type { IBaseNodeResourceHandler } from './base-node-resource-handler';
import { BASE_NODE_RESOURCE_HANDLERS } from './base-node-resource-handler';

/** The node handlers of an edition, by the kind each covers. */
@Injectable()
export class BaseNodeResourceHandlerRegistry {
  private readonly handlers = new Map<BaseNodeResourceType, IBaseNodeResourceHandler>();

  constructor(@Inject(BASE_NODE_RESOURCE_HANDLERS) handlers: IBaseNodeResourceHandler[]) {
    for (const handler of handlers) {
      if (this.handlers.has(handler.type)) {
        throw new Error(`Two base node handlers claim the resource type ${handler.type}`);
      }
      this.handlers.set(handler.type, handler);
    }
  }

  get(type: string): IBaseNodeResourceHandler | undefined {
    return this.handlers.get(type as BaseNodeResourceType);
  }

  all(): IBaseNodeResourceHandler[] {
    return [...this.handlers.values()];
  }
}
