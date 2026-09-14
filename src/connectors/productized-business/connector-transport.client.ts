import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { ConnectorInvocationResponseV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { parseConnectorInvocationResponseV1 } from '@internal-ai-assistant/connector-runtime-contract';
import type { ConnectorDeployment } from './connector-deployment.registry';
import type { ConnectorNetworkPolicy } from './connector-network-policy';

export type SignedInvocation=Readonly<{bytes:Buffer;proof:string;requestId:string}>;
export type ConnectorRequestFactory=(options:RequestOptions,callback:(response:any)=>void)=>any;
type ExchangeResult=Readonly<{ok:true;value:ConnectorInvocationResponseV1}>|Readonly<{ok:false;code:'CONNECTOR_DESTINATION_REJECTED'|'CONNECTOR_UPSTREAM_FAILED'|'CONNECTOR_RESPONSE_INVALID'|'CONNECTOR_TIMEOUT'|'CONNECTOR_REQUEST_INVALID'}>;

export class ConnectorTransportClient {
  constructor(private readonly network:ConnectorNetworkPolicy,private readonly requestFactory:ConnectorRequestFactory=httpsRequest){}
  async exchange(deployment:ConnectorDeployment,signed:SignedInvocation,callerSignal:AbortSignal,callerRemainingMs:number):Promise<ExchangeResult>{
    if(callerSignal.aborted||callerRemainingMs<=0)return fail('CONNECTOR_TIMEOUT');
    if(signed.bytes.length<1||signed.bytes.length>deployment.maxRequestBytes)return fail('CONNECTOR_REQUEST_INVALID');
    const uri=new URL(deployment.invocationUri);const controller=new AbortController();const abort=()=>controller.abort();callerSignal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,Math.min(deployment.maxTransportMs,callerRemainingMs));
    try{
      const pin=await this.network.resolve(uri.hostname,deployment.destinationPolicy,controller.signal);if(!pin.ok)return pin;
      if(controller.signal.aborted)return fail('CONNECTOR_TIMEOUT');
      return await new Promise<ExchangeResult>((resolve)=>{
        let settled=false;let activeResponse:any;const chunks:Buffer[]=[];
        const finish=(value:ExchangeResult)=>{if(!settled){settled=true;chunks.length=0;controller.signal.removeEventListener('abort',onAbort);resolve(value);}};
        let req:any;
        const onAbort=()=>{activeResponse?.destroy?.();req?.destroy?.();finish(fail('CONNECTOR_TIMEOUT'));};
        req=this.requestFactory({protocol:'https:',method:'POST',hostname:uri.hostname,port:uri.port||443,path:uri.pathname,rejectUnauthorized:true,servername:uri.hostname,agent:false,lookup:pin.value.lookup as RequestOptions['lookup'],headers:{accept:'application/json','accept-encoding':'identity','content-type':'application/json','content-length':signed.bytes.length,'x-request-id':signed.requestId,authorization:`Bearer ${signed.proof}`}},(res:any)=>{
          activeResponse=res;
          const status=Number(res.statusCode);const type=String(res.headers?.['content-type']??'').split(';')[0].trim().toLowerCase();const encoding=res.headers?.['content-encoding'];
          if(status>=300&&status<400){req.destroy();finish(fail('CONNECTOR_DESTINATION_REJECTED'));return;}
          if(status<200||status>=600){req.destroy();finish(fail('CONNECTOR_UPSTREAM_FAILED'));return;}
          if(type!=='application/json'||(encoding!==undefined&&encoding!=='identity')){req.destroy();finish(fail('CONNECTOR_DESTINATION_REJECTED'));return;}
          let total=0;res.on('data',(chunk:Buffer|string)=>{if(settled)return;const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=bytes.length;if(total>deployment.maxResponseBytes){req.destroy();finish(fail('CONNECTOR_RESPONSE_INVALID'));}else chunks.push(bytes);});
          res.on('end',()=>{if(settled)return;const parsed=parseConnectorInvocationResponseV1(Buffer.concat(chunks),signed.requestId);finish(parsed.ok&&(status===200||parsed.value.status==='failed')?{ok:true,value:parsed.value}:fail(status===200?'CONNECTOR_RESPONSE_INVALID':'CONNECTOR_UPSTREAM_FAILED'));});res.on('error',()=>finish(controller.signal.aborted?fail('CONNECTOR_TIMEOUT'):fail('CONNECTOR_UPSTREAM_FAILED')));
        });
        controller.signal.addEventListener('abort',onAbort,{once:true});req.on('error',()=>finish(controller.signal.aborted?fail('CONNECTOR_TIMEOUT'):fail('CONNECTOR_UPSTREAM_FAILED')));req.end(signed.bytes);
      });
    }finally{clearTimeout(timer);callerSignal.removeEventListener('abort',abort);}
  }
}
type ExchangeFailureCode=Extract<ExchangeResult,{ok:false}>['code'];
function fail(code:ExchangeFailureCode):ExchangeResult{return Object.freeze({ok:false,code});}
