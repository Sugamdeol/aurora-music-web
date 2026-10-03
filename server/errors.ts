import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'REQUEST_TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'SYNC_UNAVAILABLE'
  | 'SYNC_STORAGE_ERROR'
  | 'USERNAME_TAKEN'
  | 'AUTH_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'BAD_ORIGIN'
  | 'SYNC_TOO_LARGE'
  | 'INTERNAL_ERROR';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function validationError(error: ZodError): HttpError {
  const message = error.issues[0]?.message || 'The request contains invalid values.';
  return new HttpError(400, 'BAD_REQUEST', message, error.flatten());
}

export function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HttpError(504, 'REQUEST_TIMEOUT', message)), timeoutMs);
    timer.unref?.();
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => void handler(req, res, next).catch(next);
}

export function sendError(req: Request, res: Response, error: HttpError): void {
  const requestId = String(res.locals.requestId || '');
  const isCompatibilityRoute = res.locals.apiVersion === 'compatibility' || req.baseUrl === '/api';

  if (isCompatibilityRoute) {
    res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
      requestId,
    });
    return;
  }

  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      requestId,
    },
  });
}

export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(req, res, new HttpError(404, 'NOT_FOUND', 'The requested endpoint does not exist.'));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    sendError(req, res, validationError(error));
    return;
  }

  if (error instanceof HttpError) {
    sendError(req, res, error);
    return;
  }

  const parserError = error as { status?: number; type?: string } | undefined;
  if (parserError?.status === 400 && parserError.type === 'entity.parse.failed') {
    sendError(req, res, new HttpError(400, 'BAD_REQUEST', 'The request body is not valid JSON.'));
    return;
  }

  if (parserError?.status === 413 && parserError.type === 'entity.too.large') {
    sendError(req, res, new HttpError(413, 'SYNC_TOO_LARGE', 'The data is too large to upload. Your local library is safe. Export a backup from Settings before reducing history or playlist size.'));
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${String(res.locals.requestId || 'no-request-id')}] Unhandled request error:`, message);
  sendError(req, res, new HttpError(500, 'INTERNAL_ERROR', 'Aurora encountered an unexpected error.'));
};

