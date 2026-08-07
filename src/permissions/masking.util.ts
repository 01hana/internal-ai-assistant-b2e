export const MASKED_VALUE = '[MASKED]';

export interface FieldMaskingPolicy {
  allowedFields?: string[];
  deniedFields?: string[];
  maskValue?: string;
}

export interface RowPermissionResult<T> {
  allowed: boolean;
  row?: T;
  reason?: string;
}

export function maskFields<T extends Record<string, unknown>>(record: T, policy: FieldMaskingPolicy): T {
  const maskValue = policy.maskValue ?? MASKED_VALUE;
  const deniedFields = new Set(policy.deniedFields ?? []);
  const allowedFields = policy.allowedFields ? new Set(policy.allowedFields) : undefined;

  return Object.fromEntries(
    Object.entries(record).map(([field, value]) => {
      if (deniedFields.has(field) || (allowedFields && !allowedFields.has(field))) {
        return [field, maskValue];
      }

      return [field, value];
    })
  ) as T;
}

export function filterRow<T>(row: T, allowed: boolean, reason?: string): RowPermissionResult<T> {
  if (!allowed) {
    return {
      allowed: false,
      reason
    };
  }

  return {
    allowed: true,
    row
  };
}

export function minimizeForLlmInput<T extends Record<string, unknown>>(record: T, allowedFields: string[]): Partial<T> {
  const allowed = new Set(allowedFields);
  return Object.fromEntries(Object.entries(record).filter(([field]) => allowed.has(field))) as Partial<T>;
}
