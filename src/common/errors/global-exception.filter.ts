import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  InternalServerErrorException
} from '@nestjs/common';
import { Response } from 'express';
import { getRequestId } from '../request-id/request-id.util';
import { RequestWithRequestId } from '../request-id/request-id.middleware';
import { redactSecrets } from '../logger/redaction.util';

type ErrorResponseBody = {
  message?: string | string[];
  error?: string;
  statusCode?: number;
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<RequestWithRequestId>();
    const response = ctx.getResponse<Response>();
    const httpException = exception instanceof HttpException ? exception : new InternalServerErrorException();
    const status = httpException.getStatus();
    const exceptionResponse = httpException.getResponse();
    const body = typeof exceptionResponse === 'object' ? (exceptionResponse as ErrorResponseBody) : {};

    response.status(status).json({
      requestId: getRequestId(request),
      error: {
        code: this.toErrorCode(status, body.error),
        message: redactSecrets(this.toSafeMessage(status, body.message ?? httpException.message)),
        details: status === HttpStatus.INTERNAL_SERVER_ERROR ? undefined : redactSecrets(this.toDetails(body.message))
      }
    });
  }

  private toErrorCode(status: number, error?: string): string {
    if (error) {
      return error.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    }

    return `HTTP_${status}`;
  }

  private toSafeMessage(status: number, message: string | string[]): string {
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      return 'Unexpected server error.';
    }

    return Array.isArray(message) ? message.join('; ') : message;
  }

  private toDetails(message: string | string[] | undefined) {
    if (Array.isArray(message)) {
      return { validationErrors: message };
    }

    return undefined;
  }
}
