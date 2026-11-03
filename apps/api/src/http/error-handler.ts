// One error shape for every failure: {error: {code, message, retryable}}. AppErrors keep their code;
// request validation is 400 VALIDATION_ERROR, an oversized body 413, an unknown route 404 NOT_FOUND,
// a rate limit 429; anything else is logged in full and answered as a generic 500 INTERNAL.
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../shared/errors.ts';

function fromFastify(error: FastifyError): AppError | null {
  if (hasZodFastifySchemaValidationErrors(error) || error.validation) {
    const first = error.validation?.[0] as { instancePath?: string; message?: string } | undefined;
    const where = first?.instancePath ? ` at ${first.instancePath}` : '';
    return new AppError('VALIDATION_ERROR', `Invalid ${error.validationContext ?? 'request'}${where}: ${first?.message ?? 'bad value'}`);
  }
  if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (error.statusCode === 429) return new AppError('RATE_LIMITED', 'Too many requests; slow down');
  if (error.code?.startsWith('FST_ERR_CTP_') || error.code === 'FST_ERR_INVALID_URL') {
    return new AppError('VALIDATION_ERROR', 'The request body or URL could not be parsed');
  }
  return null;
}

export function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const known = error instanceof AppError ? error : fromFastify(error);
    if (known) {
      if (known.status >= 500) request.log.warn({ code: known.code, err: known.cause ?? known }, known.message);
      return reply.code(known.status).send(known.toBody());
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(new AppError('INTERNAL', 'Internal error').toBody());
  });
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send(new AppError('NOT_FOUND', `No route ${request.method} ${request.url.split('?')[0]}`).toBody());
  });
}
