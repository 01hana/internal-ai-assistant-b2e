import { Injectable, LoggerService } from '@nestjs/common';
import { redactSecrets } from './redaction.util';

export type StructuredLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'verbose';

export type StructuredLogEntry = {
  timestamp: string;
  level: StructuredLogLevel;
  requestId?: string;
  context?: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type StructuredLogSink = (entry: StructuredLogEntry) => void;

@Injectable()
export class StructuredLoggerService implements LoggerService {
  constructor(private readonly sink: StructuredLogSink = (entry) => console.log(JSON.stringify(entry))) {}

  log(message: string, context?: string, metadata?: Record<string, unknown>) {
    this.write('info', message, context, metadata);
  }

  error(message: string, traceOrContext?: string, contextOrMetadata?: string | Record<string, unknown>) {
    const metadata =
      typeof contextOrMetadata === 'object'
        ? contextOrMetadata
        : traceOrContext
          ? { trace: traceOrContext }
          : undefined;
    const context = typeof contextOrMetadata === 'string' ? contextOrMetadata : undefined;

    this.write('error', message, context, metadata);
  }

  warn(message: string, context?: string, metadata?: Record<string, unknown>) {
    this.write('warn', message, context, metadata);
  }

  debug(message: string, context?: string, metadata?: Record<string, unknown>) {
    this.write('debug', message, context, metadata);
  }

  verbose(message: string, context?: string, metadata?: Record<string, unknown>) {
    this.write('verbose', message, context, metadata);
  }

  write(
    level: StructuredLogLevel,
    message: string,
    context?: string,
    metadata?: Record<string, unknown>,
    requestId?: string
  ) {
    this.sink({
      timestamp: new Date().toISOString(),
      level,
      requestId,
      context,
      message: redactSecrets(message),
      metadata: metadata ? redactSecrets(metadata) : undefined
    });
  }
}
