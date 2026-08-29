import { Injectable } from '@nestjs/common';
import type { SigningKeyConfig } from '../config/bridge-config.service';

export type RetirementBounds = Readonly<{
  tokenLifetime: number;
  clockTolerance: number;
  jwksCacheAge: number;
  unknownKidCooldown: number;
  propagationMargin: number;
}>;
export type RetirementEvidence = Readonly<{ lastIssuedAt: number; now: number; bounds?: RetirementBounds }>;
export type RetirementEvidenceByKid = Readonly<Record<string, RetirementEvidence>>;

const BASELINE_BOUNDS: RetirementBounds = Object.freeze({
  tokenLifetime: 300,
  clockTolerance: 300,
  jwksCacheAge: 600,
  unknownKidCooldown: 30,
  propagationMargin: 60
});
const MINIMUM_RETIREMENT_OVERLAP_SECONDS = 1500;
const PUBLIC_JWK_FIELDS = Object.freeze(['alg', 'e', 'kid', 'kty', 'n', 'use']);
const PRIVATE_JWK_FIELDS = Object.freeze(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']);

export class BridgeJwksError extends Error {
  constructor() {
    super('Bridge JWKS failed: bridge_jwks_invalid.');
    this.name = 'BridgeJwksError';
  }
}

@Injectable()
export class KeyLifecycleService {
  validateCurrent(keys: readonly SigningKeyConfig[]): void {
    try {
      validateSnapshot(keys);
    } catch {
      throw new BridgeJwksError();
    }
  }

  validateTransition(previous: readonly SigningKeyConfig[], next: readonly SigningKeyConfig[], retirementEvidence: RetirementEvidenceByKid = {}): void {
    try {
      validateSnapshot(previous);
      validateSnapshot(next);
      const previousByKid = new Map(previous.map((key) => [key.kid, key]));
      const nextByKid = new Map(next.map((key) => [key.kid, key]));
      const previousActive = previous.find((key) => key.status === 'active')!;
      const nextActive = next.find((key) => key.status === 'active')!;

      if (previousActive.kid !== nextActive.kid) {
        if (previousByKid.get(nextActive.kid)?.status !== 'published') fail();
        if (nextByKid.get(previousActive.kid)?.status !== 'retiring') fail();
      }

      for (const key of next.filter((entry) => entry.status === 'retiring')) {
        const priorStatus = previousByKid.get(key.kid)?.status;
        if (priorStatus !== 'active' && priorStatus !== 'retiring') fail();
      }

      for (const key of previous.filter((entry) => entry.status === 'retiring' && !nextByKid.has(entry.kid))) {
        const evidence = retirementEvidence[key.kid];
        if (!evidence || !this.isRetirementEligible(evidence.lastIssuedAt, evidence.now, evidence.bounds)) fail();
      }
    } catch {
      throw new BridgeJwksError();
    }
  }

  requiredOverlap(bounds: RetirementBounds = BASELINE_BOUNDS): number {
    try {
      const values = Object.values(bounds);
      if (values.length !== 5 || values.some((value) => !Number.isInteger(value) || value < 0)) fail();
      return Math.max(MINIMUM_RETIREMENT_OVERLAP_SECONDS, values.reduce((sum, value) => sum + value, 0));
    } catch {
      throw new BridgeJwksError();
    }
  }

  isRetirementEligible(lastIssuedAt: number, now: number, bounds: RetirementBounds = BASELINE_BOUNDS): boolean {
    try {
      if (!Number.isInteger(lastIssuedAt) || lastIssuedAt < 0 || !Number.isInteger(now) || now < lastIssuedAt) fail();
      return now - lastIssuedAt >= this.requiredOverlap(bounds);
    } catch {
      throw new BridgeJwksError();
    }
  }
}

function validateSnapshot(keys: readonly SigningKeyConfig[]): void {
  if (!Array.isArray(keys) || keys.length === 0) fail();
  const seen = new Set<string>();
  let activeCount = 0;
  for (const key of keys) {
    if (!key || typeof key !== 'object' || typeof key.kid !== 'string' || !key.kid.trim() || seen.has(key.kid)) fail();
    if (!['published', 'active', 'retiring'].includes(key.status)) fail();
    seen.add(key.kid);
    if (key.status === 'active') activeCount += 1;
    validatePublicJwk(key);
  }
  if (activeCount !== 1) fail();
}

function validatePublicJwk(key: SigningKeyConfig): void {
  const jwk = key.publicJwk;
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) fail();
  if (Object.keys(jwk).sort().join(',') !== PUBLIC_JWK_FIELDS.join(',')) fail();
  if (jwk.kty !== 'RSA' || jwk.alg !== 'RS256' || jwk.use !== 'sig' || jwk.kid !== key.kid) fail();
  if (typeof jwk.n !== 'string' || !jwk.n || typeof jwk.e !== 'string' || !jwk.e) fail();
  if (PRIVATE_JWK_FIELDS.some((field) => field in jwk)) fail();
}

function fail(): never {
  throw new BridgeJwksError();
}
