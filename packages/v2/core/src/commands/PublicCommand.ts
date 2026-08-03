import type { IPublicCommand } from '../ports/CommandBus';

export abstract class PublicCommand implements IPublicCommand {
  declare readonly __publicCommandBrand: 'public';
}
