import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashFilesAndValues, LocalAssistantError, ROOT } from './local-lib.mjs';

export const SHINMONE_LOCAL_SCOPE = Object.freeze({
  customerId: 'customer-shinmone-scm-local',
  integrationId: 'shinmone-scm-assistant-local',
  hostApp: 'shinmone-scm'
});
export const SHINMONE_DASHBOARD_READ_SCOPE = 'menu:SCM_DASHBOARD:read';
const scopeKey = `${SHINMONE_LOCAL_SCOPE.customerId}/${SHINMONE_LOCAL_SCOPE.integrationId}`;
const contractFiles = [
  'apps/customer-connector-runtime/integrations/shinmone/kpistats-six-metric.demo.manifest.json',
  'customer-capability-packs/shinmone-scm-kpistats-demo/1.0.0.json',
  'test/fixtures/shinmone-kpistats-demo-tool-catalog.json'
].map((path) => join(ROOT, path));

export function shinmoneContractHash() {
  if (contractFiles.some((path) => !existsSync(path))) rejectSelection('KPIStats contract is missing.');
  return hashFilesAndValues(contractFiles, SHINMONE_LOCAL_SCOPE);
}

export function resolveShinmoneStartup(state, args) {
  const selected = state.localIntegrationSelections?.[scopeKey];
  if (selected && (selected.customerId !== SHINMONE_LOCAL_SCOPE.customerId ||
      selected.integrationId !== SHINMONE_LOCAL_SCOPE.integrationId ||
      selected.hostApp !== SHINMONE_LOCAL_SCOPE.hostApp ||
      selected.mode !== 'kpistats-demo' ||
      selected.requiredPermissionScope !== SHINMONE_DASHBOARD_READ_SCOPE ||
      selected.contractHash !== shinmoneContractHash())) {
    rejectSelection('Persisted Shinmone local mode or contract is invalid.');
  }
  if (args.length === 0) return { action: 'daily', mode: selected ? 'kpistats-demo' : 'c01' };
  if (args.length === 1 && args[0] === '--kpistats-demo' && !selected) {
    return { action: 'activate', mode: 'kpistats-demo', contractHash: shinmoneContractHash() };
  }
  if (args.length === 1 && args[0] === '--rollback-shinmone-kpistats' && selected) {
    return { action: 'rollback', mode: 'c01' };
  }
  throw new LocalAssistantError('LOCAL_ENV_INVALID', 'Unsupported or unsafe local Shinmone tool mode transition.');
}

export function assertShinmoneModeSwitchServicesIdle(startup, servicesActive) {
  if (startup.action !== 'daily' && servicesActive) {
    throw new LocalAssistantError('KPISTATS_SELECTION_INVALID',
      'Stop existing local services explicitly before switching the Shinmone Tool mode.');
  }
}

export function commitShinmoneSelection(state, startup) {
  if (startup.action === 'activate') {
    state.localIntegrationSelections = {
      ...state.localIntegrationSelections,
      [scopeKey]: { ...SHINMONE_LOCAL_SCOPE, mode: 'kpistats-demo',
        requiredPermissionScope: SHINMONE_DASHBOARD_READ_SCOPE,
        contractHash: startup.contractHash, selectedAt: new Date().toISOString() }
    };
  } else if (startup.action === 'rollback') {
    const selections = { ...state.localIntegrationSelections };
    delete selections[scopeKey];
    state.localIntegrationSelections = selections;
  }
}

function rejectSelection(message) { throw new LocalAssistantError('KPISTATS_SELECTION_INVALID', message); }
