import type { ClosedJsonSchemaV1 } from '@internal-ai-assistant/connector-runtime-contract';

export function validateClosedJsonSchema(schema: ClosedJsonSchemaV1, value: unknown): boolean {
  if (value === null) return 'nullable' in schema && schema.nullable === true;
  if (schema.type === 'string') return typeof value === 'string' &&
    (schema.minLength === undefined || value.length >= schema.minLength) && (schema.maxLength === undefined || value.length <= schema.maxLength);
  if (schema.type === 'integer') return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) &&
    (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) &&
    (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'array') return Array.isArray(value) && value.length <= schema.maxItems && value.every((item) => validateClosedJsonSchema(schema.items, item));
  if (schema.type !== 'object') return false;
  if (!plainObject(value)) return false;
  const properties = new Map(schema.properties.map((property) => [property.name, property.schema]));
  const keys = Object.keys(value);
  if (keys.some((key) => !properties.has(key)) || schema.required.some((key) => !(key in value))) return false;
  return keys.every((key) => validateClosedJsonSchema(properties.get(key)!, value[key]));
}

function plainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
