import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { parseConnectorInvocationRequestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { createCustomerConnectorRuntimeApplication } from '../../apps/customer-connector-runtime/src/main';
import { validRuntimeEnvironment } from '../../apps/customer-connector-runtime/test/fixtures/runtime-environment';
import { RuntimeReadinessRegistry, RuntimeReadinessService } from '../../apps/customer-connector-runtime/src/health/readiness.service';
import { ProductizedBusinessConnectorModule, ProductizedBusinessConnectorTransportService } from '../../src/connectors/productized-business/productized-business-connector.module';
import { createEphemeralTlsTestFixture, type EphemeralTlsTestFixture } from '../../apps/customer-connector-runtime/test/fixtures/ephemeral-tls-test-fixture';

describe('dark central transport to real Customer-local Phase 6 route',()=>{
  let tlsFixture: EphemeralTlsTestFixture;
  beforeAll(async()=>{tlsFixture=await createEphemeralTlsTestFixture();});
  afterAll(async()=>{await tlsFixture.dispose();});

  it('authenticates exact signed bytes and validates the genuine correlated binding failure',async()=>{
    const pair=generateKeyPairSync('rsa',{modulusLength:2048});const publicJwk={...pair.publicKey.export({format:'jwk'}),kid:'central-phase7',alg:'RS256',use:'sig'};
    const runtimeEnv=validRuntimeEnvironment();runtimeEnv.CONNECTOR_CENTRAL_TRUST_KEYS_JSON=JSON.stringify([{kind:'central-invocation',profileKey:'central-phase7',typ:'assistant-connector-service+jwt',issuer:'urn:assistant:connector',subject:'central-adapter',audience:'urn:assistant:connector:customer-b:inventory-b:customer-b-inventory:business:customer-b-inventory-connector-1',keyDomain:'central-phase7-domain',trustedContext:{customerId:'customer-b',integrationId:'inventory-b',hostApp:'customer-b-inventory',connectorInstanceId:'customer-b-inventory-connector-1'},keys:[{kid:'central-phase7',status:'active',publicJwk}]}]);
    const runtime=await createCustomerConnectorRuntimeApplication(runtimeEnv);await runtime.init();
    const runtimeReadiness=runtime.get(RuntimeReadinessRegistry);
    for(const dependency of ['bindingRoute','credentialProfiles','manifest','upstream','invocationRoute'] as const)runtimeReadiness.setReady(dependency,true);
    expect(runtime.get(RuntimeReadinessService).snapshot()).toMatchObject({configurationValid:true,ready:true,missing:[]});
    const server=createServer({cert:tlsFixture.certificate,key:tlsFixture.privateKey},runtime.getHttpAdapter().getInstance());await new Promise<void>((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));const port=(server.address() as AddressInfo).port;
    const dir=mkdtempSync(join(tmpdir(),'phase7-key-'));const privatePath=join(dir,'active.pem');writeFileSync(privatePath,pair.privateKey.export({format:'pem',type:'pkcs8'}));
    const environment={ASSISTANT_CONNECTOR_SERVICE_ISSUER:'urn:assistant:connector',ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON:JSON.stringify([{version:'1',customerId:'customer-b',integrationId:'inventory-b',hostApp:'customer-b-inventory',connectorKey:'business',connectorInstanceId:'customer-b-inventory-connector-1',active:true,invocationUri:`https://phase6-upstream.test:${port}/v1/connector/invocations`,serviceAuthProfileKey:'central-phase7',destinationPolicy:{mode:'public_only',allowedCidrs:[]},maxRequestBytes:16384,maxResponseBytes:16384,maxTransportMs:4500}]),ASSISTANT_CONNECTOR_SERVICE_KEYS_JSON:JSON.stringify([{profileKey:'central-phase7',typ:'assistant-connector-service+jwt',subject:'central-adapter',keyDomain:'central-phase7-domain',keys:[{kid:'central-phase7',status:'active',publicJwk,privateKeyReference:`file://${privatePath}`}]}])};
    const module=await Test.createTestingModule({imports:[ProductizedBusinessConnectorModule.register({environment,allowTestLoopbackTls:true,resolver:async()=>[{address:'127.0.0.1',family:4}],requestFactory:(options,callback)=>httpsRequest({...options,ca:tlsFixture.certificate},callback)})]}).compile();
    const service=module.get(ProductizedBusinessConnectorTransportService);
    const raw=Buffer.from(JSON.stringify({version:'1',requestId:'req-phase7-roundtrip',remainingBudgetMs:4500,trustedContext:{customerId:'customer-b',integrationId:'inventory-b',hostApp:'customer-b-inventory',organizationId:'org-b',actorId:'actor-b',connectorKey:'business',connectorInstanceId:'customer-b-inventory-connector-1'},operation:{key:'inventory.stock-on-hand',version:'1.0.0',arguments:{sku:'SKU-1'}},connectorContextRef:'ccr_unknown_reference'}));const parsed=parseConnectorInvocationRequestV1(raw);if(!parsed.ok)throw new Error('fixture');
    try{
      expect(await service.invoke(parsed.value,new AbortController().signal,4500)).toEqual({ok:true,value:{version:'1',requestId:'req-phase7-roundtrip',status:'failed',error:{code:'CONNECTOR_BINDING_INVALID'}}});expect(service.readiness()).toEqual({status:'ready',productionReady:false});
      const wrongHost={...environment,ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON:JSON.stringify([{...JSON.parse(environment.ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON)[0],invocationUri:`https://wrong-host.test:${port}/v1/connector/invocations`}])};
      const wrongModule=await Test.createTestingModule({imports:[ProductizedBusinessConnectorModule.register({environment:wrongHost,allowTestLoopbackTls:true,resolver:async()=>[{address:'127.0.0.1',family:4}],requestFactory:(options,callback)=>httpsRequest({...options,ca:tlsFixture.certificate},callback)})]}).compile();
      expect(wrongModule.get(ProductizedBusinessConnectorTransportService).readiness()).toEqual({status:'ready',productionReady:false});
      expect(await wrongModule.get(ProductizedBusinessConnectorTransportService).invoke(parsed.value,new AbortController().signal,4500)).toEqual({ok:false,code:'CONNECTOR_UPSTREAM_FAILED'});
      const untrustedModule=await Test.createTestingModule({imports:[ProductizedBusinessConnectorModule.register({environment,allowTestLoopbackTls:true,resolver:async()=>[{address:'127.0.0.1',family:4}]})]}).compile();
      expect(untrustedModule.get(ProductizedBusinessConnectorTransportService).readiness()).toEqual({status:'ready',productionReady:false});
      expect(await untrustedModule.get(ProductizedBusinessConnectorTransportService).invoke(parsed.value,new AbortController().signal,4500)).toEqual({ok:false,code:'CONNECTOR_UPSTREAM_FAILED'});
    }
    finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await runtime.close();}
  });
});
