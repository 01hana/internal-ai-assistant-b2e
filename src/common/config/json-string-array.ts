/** True when `value` is a JSON array of strings, e.g. `ASSISTANT_CAPABILITY_PACK_PATHS_JSON` (Core and admin API). */
export function isJsonStringArray(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string');
  } catch {
    return false;
  }
}
