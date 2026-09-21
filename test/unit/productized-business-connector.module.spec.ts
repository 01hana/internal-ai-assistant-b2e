import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { ConnectorsModule } from '../../src/connectors/connectors.module';
import { ProductizedBusinessConnectorModule, ProductizedBusinessConnectorTransportService } from '../../src/connectors/productized-business/productized-business-connector.module';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { parseConnectorInvocationRequestV1 } from '@internal-ai-assistant/connector-runtime-contract';

const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const keyDirectory=mkdtempSync(join(tmpdir(),'phase7-readiness-'));
const privateKeyPath=join(keyDirectory,'active.pem');
writeFileSync(privateKeyPath,pair.privateKey.export({format:'pem',type:'pkcs8'}));
const publicJwk={...pair.publicKey.export({format:'jwk'}),kid:'central-a-1',alg:'RS256',use:'sig'};
const profile=(profileKey='central-a')=>({profileKey,typ:'assistant-connector-service+jwt',subject:'central-adapter',keyDomain:`${profileKey}-domain`,keys:[{kid:'central-a-1',status:'active',publicJwk,privateKeyReference:`file://${privateKeyPath}`}]});
const deployment=(overrides:Record<string,unknown>={})=>({version:'1',customerId:'customer-a',integrationId:'integration-a',hostApp:'host-a',connectorKey:'business',connectorInstanceId:'instance-a',active:true,invocationUri:'https://runtime.customer.test/v1/connector/invocations',serviceAuthProfileKey:'central-a',destinationPolicy:{mode:'public_only',allowedCidrs:[]},maxRequestBytes:16384,maxResponseBytes:16384,maxTransportMs:4500,...overrides});
const environment=(deployments:unknown[],profiles:unknown[]= [profile()])=>({ASSISTANT_CONNECTOR_SERVICE_ISSUER:'urn:assistant:connector',ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON:JSON.stringify(deployments),ASSISTANT_CONNECTOR_SERVICE_KEYS_JSON:JSON.stringify(profiles)});

describe('ProductizedBusinessConnectorModule dark composition',()=>{
  it('compiles fail closed with code-only readiness and no invocation when configuration is absent',async()=>{
    const module=await Test.createTestingModule({imports:[ProductizedBusinessConnectorModule.register({environment:{}})]}).compile();
    const service=module.get(ProductizedBusinessConnectorTransportService);
    expect(service.readiness()).toEqual({status:'not_ready',productionReady:false});
    expect(await service.invoke({} as never,new AbortController().signal,1000)).toEqual({ok:false,code:'CONNECTOR_UNAVAILABLE'});
  });
  it('is neither global nor imported by AppModule or ConnectorsModule and registers no controller',()=>{
    const dynamic=ProductizedBusinessConnectorModule.register({environment:{}});
    expect(dynamic.global).not.toBe(true);expect(dynamic.controllers??[]).toEqual([]);
    expect(Reflect.getMetadata('imports',AppModule)??[]).not.toContain(ProductizedBusinessConnectorModule);
    expect(Reflect.getMetadata('imports',ConnectorsModule)??[]).not.toContain(ProductizedBusinessConnectorModule);
  });
  it.each([
    ['zero active deployments',environment([])],
    ['an unknown signer profile',environment([deployment({serviceAuthProfileKey:'central-missing'})])],
    ['any unknown profile in a multi-deployment graph',environment([deployment(),deployment({customerId:'customer-b',integrationId:'inventory',hostApp:'warehouse',connectorInstanceId:'inventory-b',serviceAuthProfileKey:'central-missing'})])],
  ])('keeps %s not ready and prevents transport',async(_name,env)=>{
    const requestFactory=jest.fn();const module=await Test.createTestingModule({imports:[ProductizedBusinessConnectorModule.register({environment:env,requestFactory:requestFactory as never})]}).compile();const service=module.get(ProductizedBusinessConnectorTransportService);
    expect(service.readiness()).toEqual({status:'not_ready',productionReady:false});expect(await service.invoke({} as never,new AbortController().signal,1000)).toEqual({ok:false,code:'CONNECTOR_UNAVAILABLE'});expect(requestFactory).not.toHaveBeenCalled();
  });
  it('is ready for a complete multi-instance deployment/signer graph',async()=>{
    const env=environment([deployment(),deployment({connectorInstanceId:'instance-b',invocationUri:'https://runtime-b.customer.test/v1/connector/invocations'})]);
    const module=await Test.createTestingModule({imports:[ProductizedBusinessConnectorModule.register({environment:env})]}).compile();expect(module.get(ProductizedBusinessConnectorTransportService).readiness()).toEqual({status:'ready',productionReady:true});
  });
  it('correlates deployment, proof creation, transport, and validated response without logging protected material',async()=>{
    const logs:string[]=[];const info=jest.spyOn(console,'info').mockImplementation((value)=>logs.push(String(value)));
    const env={...environment([deployment()]),LOCAL_DEVELOPMENT:'1',LOCAL_CONNECTOR_DIAGNOSTICS:'1'};
    const requestFactory:any=(_options:any,callback:any)=>{const req=new EventEmitter() as any;req.destroy=jest.fn();req.end=()=>{const res=new EventEmitter() as any;res.statusCode=403;res.headers={'content-type':'application/json'};callback(res);queueMicrotask(()=>{res.emit('data',Buffer.from(JSON.stringify({version:'1',requestId:'request-central-events',status:'failed',error:{code:'CONNECTOR_BINDING_INVALID'}})));res.emit('end');});};return req;};
    const module=await Test.createTestingModule({imports:[ProductizedBusinessConnectorModule.register({environment:env,resolver:async()=>[{address:'8.8.8.8',family:4}],requestFactory})]}).compile();
    const parsed=parseConnectorInvocationRequestV1(Buffer.from(JSON.stringify({version:'1',requestId:'request-central-events',remainingBudgetMs:4500,trustedContext:{customerId:'customer-a',integrationId:'integration-a',hostApp:'host-a',organizationId:'organization-a',actorId:'actor-a',connectorKey:'business',connectorInstanceId:'instance-a'},operation:{key:'work-orders.monthly-new-count',version:'1.0.0',arguments:{}},connectorContextRef:`ccr_${'A'.repeat(43)}`})));
    if(!parsed.ok)throw new Error('fixture');
    try{
      await expect(module.get(ProductizedBusinessConnectorTransportService).invoke(parsed.value,new AbortController().signal,4500)).resolves.toEqual({ok:true,value:{version:'1',requestId:'request-central-events',status:'failed',error:{code:'CONNECTOR_BINDING_INVALID'}}});
      const events=logs.map(line=>JSON.parse(line));
      expect(events.map(event=>event.stage)).toEqual(['CONNECTOR_DEPLOYMENT_RESOLVED','CONNECTOR_SERVICE_PROOF_CREATED','CONNECTOR_REQUEST_SENT','CONNECTOR_RESPONSE_RECEIVED','CONNECTOR_RESPONSE_VALIDATED']);
      expect(new Set(events.map(event=>event.requestId))).toEqual(new Set(['request-central-events']));
      expect(JSON.stringify(events)).not.toMatch(/ccr_|authorization|bearer|private.?key|raw.*body|eyJ[A-Za-z0-9_-]+\./i);
    }finally{info.mockRestore();}
  });
});
