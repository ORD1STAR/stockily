import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Global safety net, not the primary error-handling mechanism — every
 * module already throws typed HttpExceptions (ModuleEntitlementException,
 * NotFoundException, etc.) with the right status/shape, and those pass
 * through here unchanged. This filter exists for what ISN'T a deliberate
 * HttpException: an unexpected error (a bug, a Prisma error that slipped
 * through, a third-party library throwing something unusual) that would
 * otherwise leak its raw message/stack straight to a client — a real
 * production concern the local dev setup never surfaced since Nest's
 * default handler behavior differs by NODE_ENV in ways easy to get wrong
 * silently. Logs the real error server-side either way.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'internal_error',
      message: 'Une erreur inattendue est survenue.',
    });
  }
}
