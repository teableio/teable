import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import {
  BadRequestException,
  Catch,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpErrorCode, type IHttpError } from '@teable/core';
import type { Request, Response } from 'express';
import type { ILoggerConfig } from '../configs/logger.config';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly configService: ConfigService<ILoggerConfig>) {}

  catch(exception: Error | HttpException, host: ArgumentsHost) {
    const enableGlobalErrorLogging = this.configService.get<boolean>('enableGlobalErrorLogging');

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (
      enableGlobalErrorLogging ||
      !(
        exception instanceof BadRequestException ||
        exception instanceof UnauthorizedException ||
        exception instanceof ForbiddenException ||
        exception instanceof NotFoundException ||
        exception instanceof NotImplementedException
      )
    )
      this.logError(exception, request);

    if (
      exception instanceof BadRequestException ||
      ('getStatus' in exception && exception.getStatus?.() === 400)
    ) {
      return response.status(400).json({
        message: exception.message,
        status: 400,
        code: HttpErrorCode.INVALID_REQUEST,
      } as IHttpError);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return response.status(status).json({ message: exception.message, status } as IHttpError);
    }

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ message: 'Internal Server Error' } as IHttpError);
  }

  protected logError(exception: Error, request: Request) {
    this.logger.error(
      {
        url: request?.url,
        message: exception.message,
      },
      exception.stack
    );
  }
}
