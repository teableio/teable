import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ErrorObject } from 'ajv';

export class AjvError extends Error {
  constructor(param: { message: string; errors: ErrorObject[] }) {
    super(param.message);
    this.errors = param.errors;
  }

  errors: ErrorObject[];
}

export class TError {
  static badRequest(message = 'Bad Request') {
    throw new BadRequestException(message);
  }

  static internalServerError(message = 'Internal Server Error') {
    throw new InternalServerErrorException(message);
  }

  static notFound(message = 'Not Found') {
    throw new NotFoundException(message);
  }

  static ajvValidationError(param: { message: string; errors: ErrorObject[] }) {
    throw new AjvError(param);
  }
}
