#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const script = require(resolve('apps/gateway/scripts/local-feature007-provision.cjs'));
const index = process.argv.indexOf('--jwks-uri');
const jwksUri = index >= 0 ? process.argv[index + 1] : undefined;

if (!jwksUri) {
  process.stderr.write('LOCAL_FEATURE007_TRANSIENT_TUNNEL_RECONCILED=NO\n');
  process.exit(1);
}
const dependencies = script.createRuntimeDependencies(process.env.DATABASE_URL);
try {
  await script.executeLocalFeature007Provisioning({
    jwksUri, verifyOnly: true, dependencies, environment: process.env
  });
  const authority = script.AUTHORITY;
  const [profile, profiles] = await Promise.all([
    dependencies.profileRepository.findById(authority.profileId),
    dependencies.profileRepository.findByIntegrationId(authority.integrationId)
  ]);
  if (!profile || profiles.length !== 1 || profiles[0].id !== authority.profileId ||
      profile.integrationId !== authority.integrationId || profile.expectedIssuer !== authority.issuer ||
      profile.expectedAudience !== authority.audience || profile.algorithm !== authority.algorithm ||
      profile.enabled !== true || profile.lifecycle !== 'active' || profile.version !== 1 ||
      (profile.replacesProfileId !== null && profile.replacesProfileId !== undefined)) throw new Error('local profile mismatch');
  await dependencies.client.registeredUpstreamTrustProfile.update({
    where: { id: authority.profileId }, data: { jwksUri }
  });
  process.stdout.write('LOCAL_FEATURE007_TRANSIENT_TUNNEL_RECONCILED=YES\n');
} catch {
  process.stderr.write('LOCAL_FEATURE007_TRANSIENT_TUNNEL_RECONCILED=NO\n');
  process.exitCode = 1;
}
finally { await dependencies.client.$disconnect().catch(() => undefined); }
