import { resolve } from 'node:path';
import { requireTargetModule } from './dynamic-target-module.helper';

export const MISSING_FEATURE010_BEHAVIOR = 'MISSING_FEATURE010_BEHAVIOR' as const;

export class MissingFeature010BehaviorError extends Error {
  readonly code = MISSING_FEATURE010_BEHAVIOR;
  readonly taskId: string;
  readonly capability: string;

  constructor(taskId: string, capability: string) {
    super(`${MISSING_FEATURE010_BEHAVIOR} [${taskId}]: ${capability}`);
    this.name = 'MissingFeature010BehaviorError';
    this.taskId = taskId;
    this.capability = capability;
  }
}

export function loadFeature010Export<T>(input: Readonly<{
  taskId: `T${number}`;
  fromTestDirectory: string;
  modulePath: string;
  exportName: string;
  capability: string;
}>): T {
  const absolutePath = resolve(input.fromTestDirectory, input.modulePath);
  const marker = `${MISSING_FEATURE010_BEHAVIOR} [${input.taskId}]: ${input.capability}`;
  let target: Record<string, unknown>;
  try {
    target = requireTargetModule(absolutePath, marker);
  } catch (error) {
    if (error instanceof Error && error.message === marker) {
      throw new MissingFeature010BehaviorError(input.taskId, input.capability);
    }
    throw error;
  }
  const candidate = target[input.exportName];
  if (candidate === undefined) {
    throw new MissingFeature010BehaviorError(input.taskId, `${input.capability}; missing export ${input.exportName}`);
  }
  return candidate as T;
}
