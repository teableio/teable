import { Injectable } from '@nestjs/common';

export interface IRecordMutationPolicyContext {
  tableId: string;
  operation: 'create' | 'update' | 'delete';
  payload: unknown;
}

type RecordMutationPolicyHandler = (context: IRecordMutationPolicyContext) => Promise<void>;

@Injectable()
export class RecordMutationPolicyService {
  private readonly handlers = new Map<string, RecordMutationPolicyHandler>();

  register(name: string, handler: RecordMutationPolicyHandler): void {
    const registered = this.handlers.get(name);
    if (registered && registered !== handler) {
      throw new Error(`Record mutation policy ${name} is already registered`);
    }
    this.handlers.set(name, handler);
  }

  async assertAllowed(context: IRecordMutationPolicyContext): Promise<void> {
    for (const handler of this.handlers.values()) {
      await handler(context);
    }
  }
}
