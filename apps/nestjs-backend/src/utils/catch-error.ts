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
  static badRequest(message = 'Bad Request'): never {
    throw new BadRequestException(message);
  }

  static internalServerError(message = 'Internal Server Error'): never {
    throw new InternalServerErrorException(message);
  }

  static notFound(message = 'Not Found'): never {
    throw new NotFoundException(message);
  }

  static ajvValidationError(param: { message: string; errors: ErrorObject[] }): never {
    throw new AjvError(param);
  }
}
