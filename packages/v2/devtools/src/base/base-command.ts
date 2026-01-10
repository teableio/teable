import { Command, Flags, Interfaces } from '@oclif/core';
import type { DependencyContainer } from '@teable/v2-di';
import {
  printOutput,
  createSuccessOutput,
  createErrorOutput,
  createEmptyDataOutput,
  isEmptyData,
  type CliOutput,
} from '../utils/output';
import { getConnectionString } from '../utils/connection';

export type BaseFlags<T extends typeof Command> = Interfaces.InferredFlags<
  (typeof BaseCommand)['baseFlags'] & T['flags']
>;

export abstract class BaseCommand<T extends typeof Command> extends Command {
  static enableJsonFlag = false;

  static baseFlags = {
    connection: Flags.string({
      char: 'c',
      description: 'Database connection string (overrides env)',
      env: 'DATABASE_URL',
      helpGroup: 'GLOBAL',
    }),
  };

  protected flags!: BaseFlags<T>;
  protected container!: DependencyContainer;

  protected getConnectionString(): string {
    return getConnectionString(this.flags.connection);
  }

  protected async initContainer(): Promise<void> {
    const { createV2NodePgContainer } = await import('@teable/v2-container-node');
    this.container = await createV2NodePgContainer({
      connectionString: this.getConnectionString(),
    });
  }

  /**
   * Type-safe service resolution from DI container
   */
  protected resolve<S>(token: symbol): S {
    return this.container.resolve(token) as S;
  }

  protected printOutput<D>(output: CliOutput<D>): void {
    printOutput(output);
  }

  protected createSuccessOutput<D>(
    command: string,
    input: Record<string, unknown>,
    data: D
  ): CliOutput<D> {
    return createSuccessOutput(command, input, data);
  }

  protected createErrorOutput(
    command: string,
    input: Record<string, unknown>,
    error: unknown
  ): CliOutput<never> {
    return createErrorOutput(command, input, error);
  }

  protected createEmptyDataOutput(
    command: string,
    input: Record<string, unknown>,
    hint: string
  ): CliOutput<never> {
    return createEmptyDataOutput(command, input, hint);
  }

  protected isEmptyData(data: unknown): boolean {
    return isEmptyData(data);
  }
}
