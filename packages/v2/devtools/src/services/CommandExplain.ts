import type { ExplainResult } from '@teable/v2-command-explain';
import type {
  ICreateFieldCommandInput,
  IDeleteFieldCommandInput,
  IDeleteTableCommandInput,
  IFieldUpdateInput,
  IPasteCommandInput,
} from '@teable/v2-core';
import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

export interface ExplainCreateFieldInput extends ICreateFieldCommandInput {
  readonly analyze: boolean;
}

export interface ExplainUpdateFieldInput {
  readonly tableId: string;
  readonly fieldId: string;
  readonly field: IFieldUpdateInput;
  readonly analyze: boolean;
}

export interface ExplainDeleteFieldInput {
  readonly baseId?: IDeleteFieldCommandInput['baseId'];
  readonly tableId: IDeleteFieldCommandInput['tableId'];
  readonly fieldId: IDeleteFieldCommandInput['fieldId'];
  readonly analyze: boolean;
}

export interface ExplainDeleteTableInput {
  readonly baseId?: IDeleteTableCommandInput['baseId'];
  readonly tableId: IDeleteTableCommandInput['tableId'];
  readonly mode?: IDeleteTableCommandInput['mode'];
  readonly analyze: boolean;
}

export interface ExplainCreateInput {
  readonly tableId: string;
  readonly fields: Record<string, unknown>;
  readonly analyze: boolean;
}

export interface ExplainUpdateInput {
  readonly tableId: string;
  readonly recordId: string;
  readonly fields: Record<string, unknown>;
  readonly analyze: boolean;
}

export interface ExplainDeleteInput {
  readonly tableId: string;
  readonly recordIds: string[];
  readonly analyze: boolean;
}

export interface ExplainPasteInput extends IPasteCommandInput {
  readonly analyze: boolean;
}

export class CommandExplain extends Context.Tag('CommandExplain')<
  CommandExplain,
  {
    readonly explainCreateField: (
      input: ExplainCreateFieldInput
    ) => Effect.Effect<ExplainResult, CliError>;
    readonly explainUpdateField: (
      input: ExplainUpdateFieldInput
    ) => Effect.Effect<ExplainResult, CliError>;
    readonly explainDeleteField: (
      input: ExplainDeleteFieldInput
    ) => Effect.Effect<ExplainResult, CliError>;
    readonly explainDeleteTable: (
      input: ExplainDeleteTableInput
    ) => Effect.Effect<ExplainResult, CliError>;
    readonly explainCreate: (input: ExplainCreateInput) => Effect.Effect<ExplainResult, CliError>;
    readonly explainUpdate: (input: ExplainUpdateInput) => Effect.Effect<ExplainResult, CliError>;
    readonly explainDelete: (input: ExplainDeleteInput) => Effect.Effect<ExplainResult, CliError>;
    readonly explainPaste: (input: ExplainPasteInput) => Effect.Effect<ExplainResult, CliError>;
  }
>() {}
