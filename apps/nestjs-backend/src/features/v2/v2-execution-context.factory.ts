import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ActorId, v2CoreTokens } from '@teable/v2-core';
import type { IExecutionContext, ITracer } from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { V2ContainerService } from './v2-container.service';

/**
 * Factory for creating V2 execution contexts with proper tracer and requestId injection.
 * Centralizes the context creation logic to ensure consistent tracing across all V2 operations.
 */
@Injectable()
export class V2ExecutionContextFactory {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  /**
   * Creates a complete execution context with actorId, tracer, and requestId.
   * @throws HttpException if user.id is not available or ActorId creation fails
   */
  async createContext(): Promise<IExecutionContext> {
    const container = await this.v2ContainerService.getContainer();
    const tracer = container.resolve<ITracer>(v2CoreTokens.tracer);

    const userId = this.cls.get('user.id');
    if (!userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }

    const userName = this.cls.get('user.name');
    const userEmail = this.cls.get('user.email');

    const actorIdResult = ActorId.create(userId);
    if (actorIdResult.isErr()) {
      throw new HttpException(actorIdResult.error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // Use CLS ID as requestId for ShareDB src matching (consistent with V1 batch.service)
    // This ensures the client that initiated the request can identify its own ops
    const requestId = this.cls.getId();

    // Get windowId from CLS for undo/redo tracking
    const windowId = this.cls.get('windowId');

    const context: IExecutionContext = {
      actorId: actorIdResult.value,
      tracer,
      requestId,
      windowId,
    };

    return {
      ...context,
      actorName: userName,
      actorEmail: userEmail,
    } as IExecutionContext;
  }
}
