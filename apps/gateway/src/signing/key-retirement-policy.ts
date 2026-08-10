export type KeyRetirementDependencies = Readonly<{
  finalOldTokenLifetimeSeconds: number;
  backendClockToleranceSeconds: number;
  remoteJwksCacheSeconds: number;
  remoteJwksCooldownSeconds: number;
  propagationMarginSeconds: number;
  enforcedMinimumOverlapSeconds: number;
  httpCacheControlSeconds: number;
}>;

export class KeyRetirementPolicy {
  constructor(private readonly dependencies: KeyRetirementDependencies) {}

  observedMinimumSeconds(): number {
    return this.dependencies.finalOldTokenLifetimeSeconds
      + this.dependencies.backendClockToleranceSeconds
      + this.dependencies.remoteJwksCacheSeconds
      + this.dependencies.remoteJwksCooldownSeconds
      + this.dependencies.propagationMarginSeconds;
  }

  assertConfigurationCompatible(): void {
    if (this.observedMinimumSeconds() > this.dependencies.enforcedMinimumOverlapSeconds) {
      throw new Error('Signing-key retirement safety configuration is incompatible.');
    }
  }

  calculateRetireAfter(retiringAt: Date): Date {
    this.assertConfigurationCompatible();
    return new Date(retiringAt.getTime() + this.dependencies.enforcedMinimumOverlapSeconds * 1000);
  }

  isRetirementEligible(input: Readonly<{ retireAfter: Date; now: Date }>): boolean {
    this.assertConfigurationCompatible();
    return input.now.getTime() >= input.retireAfter.getTime();
  }
}
