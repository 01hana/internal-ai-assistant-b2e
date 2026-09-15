import type { CredentialProfileConfiguration } from '../../src/credentials/credential.types';
import { ShinmoneBearerApplicationStrategy } from './shinmone-bearer-application.strategy';
import {
  SHINMONE_BOOTSTRAP_PROVIDER_KEY,
  SHINMONE_CREDENTIAL_KIND,
  SHINMONE_CREDENTIAL_PROFILE_REF,
  SHINMONE_BEARER_STRATEGY_KEY,
  SHINMONE_MANIFEST_PATH
} from './shinmone.constants';
import { ShinmoneIdxCredentialProvider, type ShinmoneProviderOptions } from './shinmone-idx-credential.provider';

export function createShinmoneRuntimeIntegration(options: ShinmoneProviderOptions = {}) {
  const provider = new ShinmoneIdxCredentialProvider(options);
  const strategy = new ShinmoneBearerApplicationStrategy();
  const profile: CredentialProfileConfiguration = Object.freeze({
    credentialProfileRef: SHINMONE_CREDENTIAL_PROFILE_REF,
    credentialProviderKey: SHINMONE_BOOTSTRAP_PROVIDER_KEY,
    applicationStrategyKey: SHINMONE_BEARER_STRATEGY_KEY,
    credentialKind: SHINMONE_CREDENTIAL_KIND
  });
  return Object.freeze({
    bootstrapProviders: Object.freeze([provider]),
    credentialProviders: Object.freeze([provider]),
    credentialStrategies: Object.freeze([strategy]),
    credentialProfiles: Object.freeze([profile]),
    manifestFiles: Object.freeze([SHINMONE_MANIFEST_PATH])
  });
}
