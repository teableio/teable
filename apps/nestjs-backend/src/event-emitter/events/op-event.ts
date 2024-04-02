import type { RawOpType } from '../../share-db/interface';
import { CoreEvent } from './core-event';

export interface IChangeValue {
  oldValue: unknown | undefined;
  newValue: unknown;
}

export abstract class OpEvent<Payload extends object = object> extends CoreEvent<Payload> {
  abstract rawOpType: RawOpType;
}
