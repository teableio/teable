import { z } from '../zod';

/**
 * What a published template promises.
 *
 * A `template` is a structure: use it and the base is yours. A `solution` is a
 * running outcome — its workflows and apps depend on external accounts, so
 * using it goes through a setup wizard that connects those integrations
 * before anything is switched on. Same snapshot engine either way; the kind
 * only decides which front door the entry is offered through.
 */
export enum TemplateKind {
  Template = 'template',
  Solution = 'solution',
}

export const templateKindSchema = z.enum(TemplateKind);
