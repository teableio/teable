import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Catch, Controller, HttpException, Injectable, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Implement } from '@orpc/nest';
import { ORPCError } from '@orpc/server';
import { v2ShareContract } from '@teable/v2-contract-http';
import { createV2ShareRouter } from '@teable/v2-contract-http-implementation';
import type { Request, Response } from 'express';
import { AllowAnonymous } from '../../auth/decorators/allow-anonymous.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { TokenAccess } from '../../auth/decorators/token.decorator';
import { AuthGuard } from '../../auth/guard/auth.guard';
import { V2ShareService } from './v2-share.service';

/** Resolve real session/PAT/JWT identity even though the route has independent public admission. */
@Injectable()
export class V2ShareIdentityGuard implements CanActivate {
  constructor(private readonly auth: AuthGuard) {}
  canActivate(context: ExecutionContext) {
    return this.auth.validate(context);
  }
}

/** Public errors carry status only: no SQL, table metadata, policy details or domain diagnostics. */
@Catch()
export class V2ShareExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;
    const status = error instanceof HttpException ? error.getStatus() : error instanceof ORPCError ? error.status : 500;
    const data = error instanceof HttpException && 'data' in error ? error.data : error instanceof ORPCError ? error.data : undefined;
    const message = status === 400 ? 'Invalid share request' : status === 401 ? 'Share authentication required' : status === 402 ? 'Share write exceeds the space usage limit' : status === 403 ? 'Share operation is not allowed' : status === 404 ? 'Shared resource not found' : status === 409 ? 'Share operation conflicts with current state' : 'Share operation failed';
    const domainCode = status === 402 && typeof data === 'object' && data !== null && 'domainCode' in data
      && data.domainCode === 'usage.max_rows_exceeded' ? data.domainCode : undefined;
    response.status(status).json({ ok: false, error: { message, ...(domainCode ? { domainCode } : {}) } });
  }
}

@Controller('api/v2')
@Public()
@AllowAnonymous()
@TokenAccess()
@UseGuards(V2ShareIdentityGuard)
@UseFilters(V2ShareExceptionFilter)
export class V2ShareController {
  constructor(private readonly share: V2ShareService) {}

  @Implement(v2ShareContract)
  handler(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return createV2ShareRouter(this.share.bind(req, res));
  }
}
