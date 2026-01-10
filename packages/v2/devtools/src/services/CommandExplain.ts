import { Context, Effect } from 'effect';
import type { ExplainResult } from '@teable/v2-command-explain';
import type { CliError } from '../errors';

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

export class CommandExplain extends Context.Tag('CommandExplain')<
  CommandExplain,
  {
    readonly explainCreate: (input: ExplainCreateInput) => Effect.Effect<ExplainResult, CliError>;
    readonly explainUpdate: (input: ExplainUpdateInput) => Effect.Effect<ExplainResult, CliError>;
    readonly explainDelete: (input: ExplainDeleteInput) => Effect.Effect<ExplainResult, CliError>;
  }
>() {}
