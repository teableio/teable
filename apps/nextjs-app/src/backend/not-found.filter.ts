import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, NotFoundException } from '@nestjs/common';

@Catch(NotFoundException)
export class NotFoundExceptionFilter implements ExceptionFilter {
  catch(_exception: NotFoundException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    // redirect to 404 page
    response.redirect('/404');
  }
}
