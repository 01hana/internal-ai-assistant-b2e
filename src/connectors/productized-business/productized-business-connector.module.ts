import { DynamicModule, Module } from '@nestjs/common';
import type { ConnectorInvocationRequestV1, ConnectorInvocationResponseV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { ConnectorDeploymentRegistry } from './connector-deployment.registry';
import { ConnectorNetworkPolicy, type CentralDnsResolver } from './connector-network-policy';
import { ConnectorServiceAuthSigner } from './connector-service-auth.signer';
import { ConnectorTransportClient, type ConnectorRequestFactory } from './connector-transport.client';

export type ProductizedConnectorModuleOptions=Readonly<{
  environment?:Record<string,unknown>;
  resolver?:CentralDnsResolver;
  requestFactory?:ConnectorRequestFactory;
  allowTestLoopbackTls?:boolean;
}>;
type InvokeResult=Readonly<{ok:true;value:ConnectorInvocationResponseV1}>|Readonly<{ok:false;code:string}>;

export class ProductizedBusinessConnectorTransportService {
  private readonly registry?:ConnectorDeploymentRegistry;
  private readonly signer?:ConnectorServiceAuthSigner;
  private readonly client?:ConnectorTransportClient;
  private readonly configured:boolean;
  constructor(private readonly options:ProductizedConnectorModuleOptions){
    try{
      const env=options.environment??process.env;
      if(typeof env.ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON!=='string'||typeof env.ASSISTANT_CONNECTOR_SERVICE_KEYS_JSON!=='string'||typeof env.ASSISTANT_CONNECTOR_SERVICE_ISSUER!=='string')throw new Error('invalid');
      this.registry=ConnectorDeploymentRegistry.fromJson(env.ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON);
      this.signer=ConnectorServiceAuthSigner.fromConfiguration(env.ASSISTANT_CONNECTOR_SERVICE_KEYS_JSON,env.ASSISTANT_CONNECTOR_SERVICE_ISSUER);
      if(this.registry.activeCount===0||this.registry.serviceAuthProfileRefs().some((profileKey)=>!this.signer!.hasProfile(profileKey)))throw new Error('invalid');
      this.client=new ConnectorTransportClient(new ConnectorNetworkPolicy(options.resolver,options.allowTestLoopbackTls===true),options.requestFactory);
      this.configured=true;
    }catch{this.configured=false;}
  }
  readiness():Readonly<{status:'ready'|'not_ready';productionReady:boolean}>{return Object.freeze({status:this.configured?'ready':'not_ready',productionReady:this.configured&&this.options.allowTestLoopbackTls!==true});}
  async invoke(request:ConnectorInvocationRequestV1,signal:AbortSignal,remainingMs:number):Promise<InvokeResult>{
    if(!this.configured||!this.registry||!this.signer||!this.client)return unavailable();
    try{
      const c=request.trustedContext;const found=this.registry.resolve({customerId:c.customerId,integrationId:c.integrationId,hostApp:c.hostApp,connectorKey:c.connectorKey,connectorInstanceId:c.connectorInstanceId});
      if(!found.ok)return found;const signed=await this.signer.sign(request,found.value);if(!signed.ok)return signed;
      return this.client.exchange(found.value,signed.value,signal,remainingMs);
    }catch{return unavailable();}
  }
}

@Module({})
export class ProductizedBusinessConnectorModule {
  static register(options:ProductizedConnectorModuleOptions={}):DynamicModule{
    return {module:ProductizedBusinessConnectorModule,providers:[{provide:ProductizedBusinessConnectorTransportService,useFactory:()=>new ProductizedBusinessConnectorTransportService(options)}],exports:[ProductizedBusinessConnectorTransportService],controllers:[]};
  }
}
function unavailable():Readonly<{ok:false;code:'CONNECTOR_UNAVAILABLE'}>{return Object.freeze({ok:false,code:'CONNECTOR_UNAVAILABLE'});}
