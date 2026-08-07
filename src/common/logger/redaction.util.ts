const REDACTED = '[REDACTED]';

const sensitiveKeyPattern = /(api[_-]?key|authorization|credential|database[_-]?url|password|secret|token|jwt|claim|jti|jwks|signature|raw[_-]?(exception|error)|idempotency[_-]?key|connector[_-]?output|foreign[_-]?(result|output))/i;
const secretValuePatterns = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /(postgres(?:ql)?:\/\/)([^:\s/]+):([^@\s/]+)@/gi,
  /(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
];

export function redactSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      code: safeErrorCode(value),
      message: REDACTED,
      stack: REDACTED
    };
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === 'object') {
    if (value instanceof Date) {
      return new Date(value);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        nestedValue instanceof Error ? redactValue(nestedValue) : sensitiveKeyPattern.test(key) ? REDACTED : redactValue(nestedValue)
      ])
    );
  }

  return value;
}

function safeErrorCode(error: Error): string {
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'INTERNAL_ERROR';
}

function redactString(value: string): string {
  return secretValuePatterns.reduce((redacted, pattern) => {
    if (pattern.source.includes('postgres')) {
      return redacted.replace(pattern, '$1$2:[REDACTED]@');
    }

    if (pattern.source.includes('bearer')) {
      return redacted.replace(pattern, '$1[REDACTED]');
    }

    return redacted.replace(pattern, REDACTED);
  }, value);
}
