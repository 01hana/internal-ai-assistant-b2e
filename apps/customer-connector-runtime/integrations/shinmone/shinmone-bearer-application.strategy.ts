import type { ExecutionScopedCredentialMaterial } from '@internal-ai-assistant/connector-runtime-contract';
import {
  appliedCredentialRequest,
  type AppliedCredentialRequest,
  type CredentialApplicationStrategy
} from '../../src/credentials/credential.types';
import type { MappedReadRequest } from '../../src/manifest/request-profile.registry';
import { SHINMONE_BEARER_STRATEGY_KEY, SHINMONE_CREDENTIAL_KIND } from './shinmone.constants';

export class ShinmoneBearerApplicationStrategy implements CredentialApplicationStrategy {
  readonly key = SHINMONE_BEARER_STRATEGY_KEY;
  readonly credentialKind = SHINMONE_CREDENTIAL_KIND;

  apply(material: ExecutionScopedCredentialMaterial, request: MappedReadRequest): AppliedCredentialRequest {
    const value = material as unknown as Record<string, unknown>;
    if (Object.keys(value).join(',') !== 'nativeAccessToken' || typeof value.nativeAccessToken !== 'string' ||
        value.nativeAccessToken.length < 1 || value.nativeAccessToken.length > 12_000 || /[\r\n]/.test(value.nativeAccessToken)) {
      throw new Error('Shinmone credential material unavailable.');
    }
    return appliedCredentialRequest(Object.freeze({ request, Authorization: `Bearer ${value.nativeAccessToken}` }));
  }
}
