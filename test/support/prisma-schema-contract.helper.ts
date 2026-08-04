import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '../../src/generated/prisma/client';

export type SchemaModelContract = Readonly<{
  name: string;
  fields: readonly string[];
  relations: readonly SchemaRelationContract[];
  uniqueKeys: readonly (readonly string[])[];
  indexes: readonly (readonly string[])[];
}>;

export type SchemaRelationContract = Readonly<{
  fieldName: string;
  targetModel: string;
  fields: readonly string[];
  references: readonly string[];
}>;

export type PrismaSchemaContract = Readonly<{
  model(name: string): SchemaModelContract | undefined;
  hasCompoundUnique(modelName: string, fields: readonly string[]): boolean;
  hasQualifiedParentKey(modelName: string): boolean;
  hasQualifiedRelation(childModel: string, targetModel: string, localFields: readonly string[], referencedFields: readonly string[]): boolean;
}>;

/**
 * Static schema/generated-client inspector for tests. It never creates a
 * PrismaClient, opens a database connection, or emulates persistence rules.
 */
export function loadPrismaSchemaContract(): PrismaSchemaContract {
  const schema = readFileSync(resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');
  const models = new Map(parseModels(schema).map((model) => [model.name, model]));

  return Object.freeze({
    model(name) {
      const parsed = models.get(name);
      if (!parsed) return undefined;
      const generatedFields = scalarFieldsFromGeneratedClient(name);
      return Object.freeze({
        ...parsed,
        fields: Object.freeze([...new Set([...parsed.fields, ...generatedFields])])
      });
    },
    hasCompoundUnique(modelName, fields) {
      const model = models.get(modelName);
      return Boolean(model?.uniqueKeys.some((key) => sameFieldSet(key, fields)));
    },
    hasQualifiedParentKey(modelName) {
      const model = models.get(modelName);
      return Boolean(model?.uniqueKeys.some((key) => sameFieldSet(key, ['customerId', 'id'])));
    },
    hasQualifiedRelation(childModel, targetModel, localFields, referencedFields) {
      return Boolean(models.get(childModel)?.relations.some((relation) =>
        relation.targetModel === targetModel && sameFieldSet(relation.fields, localFields) && sameFieldSet(relation.references, referencedFields)
      ));
    }
  });
}

export function parsePrismaSchemaContract(schema: string): readonly SchemaModelContract[] {
  return parseModels(schema);
}

function parseModels(schema: string): SchemaModelContract[] {
  return [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((match) => {
    const [, name, body] = match;
    const fields: string[] = [];
    const relations: SchemaRelationContract[] = [];
    const uniqueKeys: string[][] = [];
    const indexes: string[][] = [];

    for (const line of body.split('\n')) {
      const field = line.match(/^\s*(\w+)\s+([A-Za-z]\w*)/);
      if (field && !line.trimStart().startsWith('@@')) {
        fields.push(field[1]);
      }
      const attribute = line.match(/^\s*@@(unique|id|index)\(\[([^]]+)\]/);
      if (attribute) {
        const key = attribute[2].split(',').map((value) => value.trim().split(':')[0]).filter(Boolean);
        if (attribute[1] === 'index') indexes.push(key);
        else uniqueKeys.push(key);
      }
      if (/@id\b/.test(line) && field) uniqueKeys.push([field[1]]);
    }

    for (const relationMatch of body.matchAll(/^\s*(\w+)\s+([A-Za-z]\w*)(?:\?|\[\])?\s+@relation\(([\s\S]*?)\)/gm)) {
      const [, fieldName, targetModel, argumentsText] = relationMatch;
      relations.push(Object.freeze({
        fieldName,
        targetModel,
        fields: Object.freeze(relationArgument(argumentsText, 'fields')),
        references: Object.freeze(relationArgument(argumentsText, 'references'))
      }));
    }

    return Object.freeze({
      name,
      fields: Object.freeze(fields),
      relations: Object.freeze(relations),
      uniqueKeys: Object.freeze(uniqueKeys.map((key) => Object.freeze(key))),
      indexes: Object.freeze(indexes.map((key) => Object.freeze(key)))
    });
  });
}

function relationArgument(argumentsText: string, name: string): string[] {
  const match = argumentsText.match(new RegExp(`${name}\\s*:\\s*\\[([^\\]]*)\\]`));
  return match ? match[1].split(',').map((value) => value.trim()).filter(Boolean) : [];
}

function scalarFieldsFromGeneratedClient(modelName: string): string[] {
  const namespace = Prisma as unknown as Record<string, unknown>;
  const scalarFieldEnum = namespace[`${modelName}ScalarFieldEnum`];
  return scalarFieldEnum && typeof scalarFieldEnum === 'object'
    ? Object.values(scalarFieldEnum).filter((value): value is string => typeof value === 'string')
    : [];
}

function sameFieldSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}
