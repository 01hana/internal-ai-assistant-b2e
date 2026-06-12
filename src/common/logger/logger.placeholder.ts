export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type StructuredLogEntry = {
  timestamp: string;
  level: LogLevel;
  requestId?: string;
  context?: string;
  message: string;
  metadata?: Record<string, unknown>;
};
