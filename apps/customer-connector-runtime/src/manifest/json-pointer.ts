import type { ClosedJsonSchemaV1 } from '@internal-ai-assistant/connector-runtime-contract';

export function schemaAtJsonPointer(schema: ClosedJsonSchemaV1, pointer: string): ClosedJsonSchemaV1 | undefined {
  let current: ClosedJsonSchemaV1 | undefined = schema;
  for (const segment of jsonPointerSegments(pointer)) {
    if (!current) return undefined;
    if (current.type === 'object' && 'properties' in current) {
      current = current.properties.find((property) => property.name === segment)?.schema;
    } else if (current.type === 'array' && /^(?:0|[1-9][0-9]*)$/.test(segment)) {
      current = current.items;
    } else {
      return undefined;
    }
  }
  return current;
}

export function valueAtJsonPointer(value: unknown, pointer: string): unknown {
  let current = value;
  for (const segment of jsonPointerSegments(pointer)) {
    if ((!plainObject(current) && !Array.isArray(current)) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function resolveJsonPointerCorridor(
  schema: ClosedJsonSchemaV1,
  value: unknown,
  pointer: string
): Readonly<{ schema: ClosedJsonSchemaV1; value: unknown }> | undefined {
  let currentSchema: ClosedJsonSchemaV1 = schema;
  let currentValue = value;
  for (const segment of jsonPointerSegments(pointer)) {
    if (currentSchema.type === 'object') {
      if (!plainObject(currentValue) || !Object.prototype.hasOwnProperty.call(currentValue, segment)) return undefined;
      const property = currentSchema.properties.find((candidate) => candidate.name === segment);
      if (!property) return undefined;
      currentSchema = property.schema;
      currentValue = currentValue[segment];
      continue;
    }
    if (currentSchema.type === 'array' && /^(?:0|[1-9][0-9]*)$/.test(segment)) {
      if (!Array.isArray(currentValue) || currentValue.length > currentSchema.maxItems || Number(segment) >= currentValue.length) return undefined;
      currentSchema = currentSchema.items;
      currentValue = currentValue[Number(segment)];
      continue;
    }
    return undefined;
  }
  return Object.freeze({ schema: currentSchema, value: currentValue });
}

export function jsonPointerSegments(pointer: string): readonly string[] {
  return pointer.split('/').slice(1).map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function plainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
