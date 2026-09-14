import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeJwt, decodeProtectedHeader, exportJWK, importJWK, jwtVerify } from 'jose';
import { parseConnectorInvocationRequestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { ConnectorDeploymentRegistry } from '../../src/connectors/productized-business/connector-deployment.registry';
import { ConnectorServiceAuthSigner } from '../../src/connectors/productized-business/connector-service-auth.signer';

function fixture() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dir = mkdtempSync(join(tmpdir(), 'connector-central-'));
  const path = join(dir, 'active.pem');
  writeFileSync(path, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  const publicJwk = pair.publicKey.export({ format: 'jwk' });
  const keyJson = JSON.stringify([{ profileKey: 'central-a', typ: 'assistant-connector-service+jwt', subject: 'central-adapter', keyDomain: 'central-only', keys: [{ kid: 'central-a-1', status: 'active', publicJwk: { ...publicJwk, kid: 'central-a-1', alg: 'RS256', use: 'sig' }, privateKeyReference: `file://${path}` }] }]);
  const deployment = ConnectorDeploymentRegistry.fromJson(JSON.stringify([{ version:'1', customerId:'customer-b', integrationId:'inventory', hostApp:'warehouse', connectorKey:'business', connectorInstanceId:'inventory-b', active:true, invocationUri:'https://runtime.test/v1/connector/invocations', serviceAuthProfileKey:'central-a', destinationPolicy:{mode:'public_only',allowedCidrs:[]}, maxRequestBytes:16384,maxResponseBytes:16384,maxTransportMs:4500 }])).resolve({customerId:'customer-b',integrationId:'inventory',hostApp:'warehouse',connectorKey:'business',connectorInstanceId:'inventory-b'});
  if (!deployment.ok) throw new Error('fixture');
  const raw = Buffer.from(JSON.stringify({version:'1',requestId:'req-central-0001',remainingBudgetMs:4500,trustedContext:{customerId:'customer-b',integrationId:'inventory',hostApp:'warehouse',organizationId:'org-b',actorId:'actor-b',connectorKey:'business',connectorInstanceId:'inventory-b'},operation:{key:'inventory.stock-on-hand',version:'1.0.0',arguments:{sku:'SKU-1'}},connectorContextRef:'ccr_reference'}));
  const parsed = parseConnectorInvocationRequestV1(raw); if (!parsed.ok) throw new Error('fixture');
  return { pair, keyJson, deployment: deployment.value, request: parsed.value };
}

describe('ConnectorServiceAuthSigner', () => {
  it('serializes once and signs the exact bytes with the complete dedicated claim set', async () => {
    const f = fixture(); let serializations = 0;
    const signer = ConnectorServiceAuthSigner.fromConfiguration(f.keyJson, 'urn:assistant:connector', { now: () => 1_800_000_000, uuid: () => '21ac1822-0827-4d6b-a5d8-cabb379a892a', serialize: (v) => { serializations++; return JSON.stringify(v); } });
    const signed = await signer.sign(f.request, f.deployment); expect(signed.ok).toBe(true); expect(serializations).toBe(1);
    if (!signed.ok) return;
    expect(JSON.parse(signed.value.bytes.toString())).toEqual(f.request);
    const header = decodeProtectedHeader(signed.value.proof); const claims = decodeJwt(signed.value.proof);
    expect(header).toEqual({ alg:'RS256',kid:'central-a-1',typ:'assistant-connector-service+jwt' });
    expect(claims).toMatchObject({iss:'urn:assistant:connector',sub:'central-adapter',aud:'urn:assistant:connector:customer-b:inventory:warehouse:business:inventory-b',iat:1800000000,nbf:1800000000,exp:1800000030,jti:'21ac1822-0827-4d6b-a5d8-cabb379a892a',proof_version:1,customer_id:'customer-b',integration_id:'inventory',host_app:'warehouse',connector_key:'business',connector_instance_id:'inventory-b',operation:'inventory.stock-on-hand',operation_version:'1.0.0',request_id:'req-central-0001',body_sha256:createHash('sha256').update(signed.value.bytes).digest('base64url')});
    await expect(jwtVerify(signed.value.proof, await importJWK(await exportJWK(f.pair.publicKey),'RS256'), { currentDate: new Date(1_800_000_000_000) })).resolves.toBeDefined();
  });

  it('proves byte mutation invalidates the digest and emits fresh UUID proof identifiers', async () => {
    const f=fixture(); const signer=ConnectorServiceAuthSigner.fromConfiguration(f.keyJson,'urn:assistant:connector');
    const a=await signer.sign(f.request,f.deployment); const b=await signer.sign(f.request,f.deployment);
    if(!a.ok||!b.ok) throw new Error('sign');
    expect(decodeJwt(a.value.proof).jti).not.toBe(decodeJwt(b.value.proof).jti);
    const mutated=Buffer.concat([a.value.bytes,Buffer.from(' ')]);
    expect(createHash('sha256').update(mutated).digest('base64url')).not.toBe(decodeJwt(a.value.proof).body_sha256);
  });

  it.each([
    ['inline key', (j:any)=>{j[0].keys[0].privateKeyReference='inline:secret';}],
    ['bootstrap type', (j:any)=>{j[0].typ='assistant-connector-binding+jwt';}],
    ['identity key domain', (j:any)=>{j[0].keyDomain='identity-signing';}],
    ['inactive private key', (j:any)=>{j[0].keys[0].status='retiring';}],
    ['unknown member', (j:any)=>{j[0].issuer='caller';}],
  ])('rejects %s',(_n,mutate)=>{const f=fixture();const j=JSON.parse(f.keyJson);mutate(j);expect(()=>ConnectorServiceAuthSigner.fromConfiguration(JSON.stringify(j),'urn:assistant:connector')).toThrow('CONNECTOR_CONFIGURATION_INVALID');});
});
