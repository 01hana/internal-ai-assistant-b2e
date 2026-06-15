const REDACTED = '[REDACTED]';

const sensitiveKeyPattern = /(api[_-]?key|authorization|credential|database[_-]?url|password|secret|token)/i;
const secretValuePatterns = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /(postgres(?:ql)?:\/\/)([^:\s/]+):([^@\s/]+)@/gi,
  /(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi
];

export function redactSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        sensitiveKeyPattern.test(key) ? REDACTED : redactValue(nestedValue)
      ])
    );
  }

  return value;
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
