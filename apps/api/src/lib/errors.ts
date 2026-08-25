/**
 * Error translation.
 *
 * repolayer raises a small, well-defined set of errors, and each one has an obvious HTTP
 * meaning. Mapping them centrally means a route never has to try/catch a database concern,
 * and — more importantly — a UniqueConstraintError surfaces as a 409 the UI can explain
 * rather than a 500 that just says something went wrong.
 */

import { NotFoundError, QueryError, UniqueConstraintError, ConnectionError } from 'repolayer';
import { ZodError } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly details: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, message, details);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, message, details);

export interface ErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

export function toErrorBody(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof HttpError) {
    return {
      status: error.statusCode,
      body: {
        error: error.statusCode === 404 ? 'not_found' : 'request_error',
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: 'validation_error',
        message: 'The request body or query is not valid',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    };
  }

  if (error instanceof UniqueConstraintError) {
    return {
      status: 409,
      body: { error: 'conflict', message: 'That record already exists' },
    };
  }

  if (error instanceof NotFoundError) {
    return { status: 404, body: { error: 'not_found', message: 'Not found' } };
  }

  if (error instanceof QueryError) {
    // A QueryError means the query could not be compiled — a bad field name or operator,
    // which reaching this point means came from a request rather than from our own code.
    return {
      status: 400,
      body: { error: 'bad_query', message: error.message },
    };
  }

  if (error instanceof ConnectionError) {
    return {
      status: 503,
      body: { error: 'database_unavailable', message: 'The database is not reachable' },
    };
  }

  return {
    status: 500,
    body: { error: 'internal_error', message: 'Something went wrong' },
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const { status, body } = toErrorBody(error);
    // Only genuine surprises are worth a stack trace in the log; a 404 is not news.
    if (status >= 500) {
      app.log.error({ err: error, url: request.url }, 'request failed');
    }
    void reply.status(status).send(body);
  });
}
