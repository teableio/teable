import { Inject, Injectable } from '@nestjs/common';
import type { TrashType } from '@teable/openapi';
import type { ITrashResourceHandler } from './trash-resource-handler';
import { TRASH_RESOURCE_HANDLERS } from './trash-resource-handler';

/** The trash handlers of an edition, by the kind each covers. */
@Injectable()
export class TrashResourceHandlerRegistry {
  private readonly handlers = new Map<TrashType, ITrashResourceHandler>();

  constructor(@Inject(TRASH_RESOURCE_HANDLERS) handlers: ITrashResourceHandler[]) {
    for (const handler of handlers) {
      if (this.handlers.has(handler.type)) {
        throw new Error(`Two trash handlers claim the resource type ${handler.type}`);
      }
      this.handlers.set(handler.type, handler);
    }
  }

  get(type: string): ITrashResourceHandler | undefined {
    return this.handlers.get(type as TrashType);
  }

  all(): ITrashResourceHandler[] {
    return [...this.handlers.values()];
  }
}
