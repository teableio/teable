import type { IExecutionContext } from './ExecutionContext';
import type { ICommandBus, IInternalCommandBus } from './CommandBus';
import type { CreateBaseCommand } from '../commands/CreateBaseCommand';
import type { PropagateUserRenameCommand } from '../commands/PropagateUserRenameCommand';

declare const context: IExecutionContext;
declare const publicBus: ICommandBus;
declare const internalBus: IInternalCommandBus;
declare const publicCommand: CreateBaseCommand;
declare const internalCommand: PropagateUserRenameCommand;

void publicBus.execute(context, publicCommand);
void internalBus.execute(context, internalCommand);

// @ts-expect-error Internal-only commands must not be executable through the public command bus.
void publicBus.execute(context, internalCommand);

// @ts-expect-error Public commands must not be executable through the internal command bus.
void internalBus.execute(context, publicCommand);
