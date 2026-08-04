export function requireTargetModule(
  modulePath: string,
  expectedRedMessage: string
): Record<string, unknown> {
  try {
    return require(modulePath) as Record<string, unknown>;
  } catch (error) {
    if (isTargetModuleNotFound(error, modulePath)) {
      throw new Error(expectedRedMessage);
    }
    throw error;
  }
}

export function isTargetModuleNotFound(error: unknown, expectedModulePath: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const message = String((error as { message?: unknown }).message);
  const code = (error as NodeJS.ErrnoException).code;
  return (
    message.includes(expectedModulePath) &&
    (code === 'MODULE_NOT_FOUND' ||
      message.includes(`Cannot find module '${expectedModulePath}'`))
  );
}
