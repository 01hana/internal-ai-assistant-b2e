const REDACTED = '[REDACTED]';

const sensitiveKeyPattern = /(api[_-]?key|authorization|credential|database[_-]?url|password|secret|token|jwt|claim|jti|jwks|signature|raw[_-]?(exception|error)|idempotency[_-]?key|connector[_-]?output|foreign[_-]?(result|output))/i;
const privateJwkContextPattern = /^(?:private[_-]?jwk(?:[_-]?material)?|jwk[_-]?private(?:[_-]?material)?|private[_-]?signing[_-]?jwk)$/i;
const privateKeyFieldPattern = /^(?:private[_-]?key(?:[_-]?pem)?|signing[_-]?private[_-]?key|private[_-]?pem)$/i;
const privateJwkMemberPattern = /^(?:d|p|q|dp|dq|qi)$/i;
const secretValuePatterns = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /(postgres(?:ql)?:\/\/)([^:\s/]+):([^@\s/]+)@/gi,
  /(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g
];

export function redactSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown, privateJwkContext = false): unknown {
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
    return value.map((item) => redactValue(item, privateJwkContext));
  }

  if (value && typeof value === 'object') {
    if (value instanceof Date) {
      return new Date(value);
    }
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => redactObjectEntry(key, nestedValue, privateJwkContext)));
  }

  return value;
}

function redactObjectEntry(key: string, value: unknown, privateJwkContext: boolean): [string, unknown] {
  if (value instanceof Error) {
    return [key, redactValue(value)];
  }

  if (sensitiveKeyPattern.test(key) || privateKeyFieldPattern.test(key) || (privateJwkContext && privateJwkMemberPattern.test(key))) {
    return [key, REDACTED];
  }

  return [key, redactValue(value, privateJwkContext || privateJwkContextPattern.test(key))];
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
