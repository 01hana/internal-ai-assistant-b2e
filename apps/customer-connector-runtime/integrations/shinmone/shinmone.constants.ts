import { join } from 'node:path';

export const SHINMONE_BOOTSTRAP_PROFILE_KEY = 'BRIDGE_BINDING_TRANSPORT_V1';
export const SHINMONE_BOOTSTRAP_PROVIDER_KEY = 'shinmone-idx-bootstrap-v1';
export const SHINMONE_CREDENTIAL_PROFILE_REF = 'shinmone-idx-bearer-v1';
export const SHINMONE_BEARER_STRATEGY_KEY = 'shinmone-fixed-bearer-v1';
export const SHINMONE_CREDENTIAL_KIND = 'bearer-v1';
export const SHINMONE_OPERATION_KEY = 'work-orders.monthly-new-count';
export const SHINMONE_MANIFEST_PATH = join(__dirname, 'work-orders.monthly-new-count.manifest.json');
