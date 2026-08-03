import type { IInternalCommand } from '../ports/CommandBus';

export abstract class InternalCommand implements IInternalCommand {
  declare readonly __internalCommandBrand: 'internal';
}
