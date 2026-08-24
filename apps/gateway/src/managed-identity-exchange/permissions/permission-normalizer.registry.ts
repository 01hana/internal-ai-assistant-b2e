import type { PermissionNormalizer, PermissionNormalizerRegistry as NormalizerRegistry } from '../domain/managed-exchange.domain';

/** Fixed deployment normalizer resolution. */
export class PermissionNormalizerRegistry implements NormalizerRegistry {
  private readonly normalizers: readonly PermissionNormalizer[];

  constructor(normalizers: readonly PermissionNormalizer[]) {
    const types = new Set<string>();
    for (const normalizer of normalizers) {
      if (typeof normalizer.normalizerType !== 'string' || normalizer.normalizerType.trim().length === 0 || types.has(normalizer.normalizerType)) {
        throw new Error('Invalid permission normalizer registration.');
      }
      types.add(normalizer.normalizerType);
    }
    this.normalizers = Object.freeze([...normalizers]);
  }

  resolve(normalizerType: string): PermissionNormalizer | undefined {
    return this.normalizers.find((normalizer) => normalizer.normalizerType === normalizerType);
  }
}
