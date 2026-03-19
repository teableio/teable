import { domainError, type DomainError, InternalCommand } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

const runComputedTaskByIdInputSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
  workerId: z.string().trim().min(1, 'Worker ID is required'),
  allowProcessingTakeover: z.boolean().optional().default(true),
});

export type IRunComputedTaskByIdCommandInput = z.input<typeof runComputedTaskByIdInputSchema>;

export type RunComputedTaskByIdResult = {
  taskId: string;
  workerId: string;
  processed: true;
};

export class RunComputedTaskByIdCommand extends InternalCommand {
  private constructor(
    readonly taskId: string,
    readonly workerId: string,
    readonly allowProcessingTakeover: boolean
  ) {
    super();
  }

  static create(raw: unknown): Result<RunComputedTaskByIdCommand, DomainError> {
    const parsed = runComputedTaskByIdInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid RunComputedTaskByIdCommand input',
          details: parsed.error.format(),
        })
      );
    }

    return ok(
      new RunComputedTaskByIdCommand(
        parsed.data.taskId,
        parsed.data.workerId,
        parsed.data.allowProcessingTakeover
      )
    );
  }
}
