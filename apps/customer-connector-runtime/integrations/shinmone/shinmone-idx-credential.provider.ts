import { randomBytes as secureRandomBytes, randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import type {
  BindingBootstrapProfileContract,
  ConnectorBindingTrustedContextV1,
  ValidatedProviderPayload
} from '@internal-ai-assistant/connector-runtime-contract';
import {
  opaqueCredentialHandle,
  type BindingBootstrapProvider,
  type BindingBootstrapProviderResult,
  type OpaqueCredentialHandle
} from '../../src/bindings/binding-bootstrap-provider';
import type { BindingRevocationReason } from '../../src/bindings/binding.types';
import { executionScopedCredentialMaterial, type CredentialProvider } from '../../src/credentials/credential.types';
import { SHINMONE_BOOTSTRAP_PROFILE_KEY, SHINMONE_BOOTSTRAP_PROVIDER_KEY, SHINMONE_CREDENTIAL_KIND } from './shinmone.constants';

interface ShinmoneBootstrapPayload {
  readonly nativeAccessToken: string;
  readonly acceptedSubject: string;
  readonly acceptedOrganization: string;
  readonly acceptedEntry: string;
}

interface ShinmoneCredentialRecord {
  readonly nativeAccessToken: string;
  readonly acceptedEntry: string;
  readonly trustedContext: ConnectorBindingTrustedContextV1;
  readonly credentialGeneration: string;
  readonly expiresAt?: number;
}

export interface ShinmoneProviderOptions {
  readonly nowSeconds?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly randomGeneration?: () => string;
}

export class ShinmoneIdxCredentialProvider implements
  BindingBootstrapProvider<typeof SHINMONE_BOOTSTRAP_PROFILE_KEY, ShinmoneBootstrapPayload>, CredentialProvider {
  readonly bootstrapProviderKey = SHINMONE_BOOTSTRAP_PROVIDER_KEY;
  readonly serviceProfileKey = SHINMONE_BOOTSTRAP_PROFILE_KEY;
  readonly key = SHINMONE_BOOTSTRAP_PROVIDER_KEY;
  readonly credentialKind = SHINMONE_CREDENTIAL_KIND;
  readonly contract: BindingBootstrapProfileContract<typeof SHINMONE_BOOTSTRAP_PROFILE_KEY, ShinmoneBootstrapPayload> = Object.freeze({
    profileKey: SHINMONE_BOOTSTRAP_PROFILE_KEY,
    maxProviderPayloadBytes: 12_288,
    parseProviderPayload: parsePayload
  });
  private readonly records = new Map<string, ShinmoneCredentialRecord>();

  constructor(private readonly options: ShinmoneProviderOptions = {}) {}

  async create(
    payload: ValidatedProviderPayload<typeof SHINMONE_BOOTSTRAP_PROFILE_KEY, ShinmoneBootstrapPayload>,
    trustedContext: ConnectorBindingTrustedContextV1
  ): Promise<BindingBootstrapProviderResult> {
    if (payload.acceptedSubject !== trustedContext.actorId || payload.acceptedOrganization !== trustedContext.organizationId) {
      throw new Error('Shinmone bootstrap context mismatch.');
    }
    const handle = this.newHandle();
    const credentialGeneration = (this.options.randomGeneration ?? randomUUID)();
    const expiresAt = numericExpiry(payload.nativeAccessToken);
    this.records.set(handle, Object.freeze({
      nativeAccessToken: payload.nativeAccessToken,
      acceptedEntry: payload.acceptedEntry,
      trustedContext: Object.freeze({ ...trustedContext }),
      credentialGeneration,
      ...(expiresAt === undefined ? {} : { expiresAt })
    }));
    return Object.freeze({
      credentialProviderKey: this.key,
      opaqueCredentialHandle: handle,
      credentialGeneration,
      ...(expiresAt === undefined ? {} : { providerExpiresAt: expiresAt }),
      providerMetadata: Object.freeze({})
    });
  }

  async resolve(handle: string, trustedContext: ConnectorBindingTrustedContextV1, credentialGeneration: string) {
    const record = this.records.get(handle);
    if (!record || record.credentialGeneration !== credentialGeneration || !sameContext(record.trustedContext, trustedContext) ||
        (record.expiresAt !== undefined && this.now() >= record.expiresAt)) {
      if (record?.expiresAt !== undefined && this.now() >= record.expiresAt) this.records.delete(handle);
      throw new Error('Shinmone credential unavailable.');
    }
    return executionScopedCredentialMaterial(Object.freeze({ nativeAccessToken: record.nativeAccessToken }));
  }

  async revoke(handle: OpaqueCredentialHandle, _reason: BindingRevocationReason): Promise<void> {
    this.records.delete(handle);
  }

  async onModuleDestroy(): Promise<void> {
    this.records.clear();
  }

  private now(): number { return Math.floor((this.options.nowSeconds ?? (() => Date.now() / 1000))()); }

  private newHandle(): OpaqueCredentialHandle {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const bytes = (this.options.randomBytes ?? secureRandomBytes)(32);
      if (bytes.byteLength !== 32) break;
      const candidate = opaqueCredentialHandle(`shc_${Buffer.from(bytes).toString('base64url')}`);
      if (candidate && !this.records.has(candidate)) return candidate;
    }
    throw new Error('Shinmone credential handle unavailable.');
  }
}

function parsePayload(value: unknown) {
  if (!plainObject(value) || Object.keys(value).sort().join(',') !== 'acceptedEntry,acceptedOrganization,acceptedSubject,nativeAccessToken') {
    return Object.freeze({ ok: false as const, code: 'CONNECTOR_REQUEST_INVALID' as const });
  }
  const fields = value as unknown as ShinmoneBootstrapPayload;
  if (!bounded(fields.nativeAccessToken, 12_000) || !bounded(fields.acceptedSubject, 128) ||
      !bounded(fields.acceptedOrganization, 128) || !bounded(fields.acceptedEntry, 128)) {
    return Object.freeze({ ok: false as const, code: 'CONNECTOR_REQUEST_INVALID' as const });
  }
  return Object.freeze({ ok: true as const, value: Object.freeze({ ...fields }) });
}

function numericExpiry(token: string): number | undefined {
  try {
    const exp = decodeJwt(token).exp;
    return typeof exp === 'number' && Number.isSafeInteger(exp) && exp > 0 ? exp : undefined;
  } catch {
    return undefined;
  }
}

function sameContext(left: ConnectorBindingTrustedContextV1, right: ConnectorBindingTrustedContextV1): boolean {
  return left.customerId === right.customerId && left.integrationId === right.integrationId && left.hostApp === right.hostApp &&
    left.connectorInstanceId === right.connectorInstanceId && left.organizationId === right.organizationId && left.actorId === right.actorId;
}
function plainObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function bounded(value: unknown, maximum: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\r\n]/.test(value); }
