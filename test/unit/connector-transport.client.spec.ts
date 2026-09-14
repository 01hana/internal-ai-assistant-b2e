import { EventEmitter } from 'node:events';
import { ConnectorTransportClient } from '../../src/connectors/productized-business/connector-transport.client';
import { ConnectorNetworkPolicy } from '../../src/connectors/productized-business/connector-network-policy';

const deployment:any={invocationUri:'https://runtime.test/v1/connector/invocations',destinationPolicy:{mode:'public_only',allowedCidrs:[]},maxRequestBytes:16384,maxResponseBytes:16384,maxTransportMs:4500};
const signed={bytes:Buffer.from('{"version":"1"}'),proof:'signed-proof',requestId:'req-central-0001'};

function requestFactory(responseBody:unknown,statusCode=200,headers:Record<string,string>={'content-type':'application/json'}) {
  const calls:any[]=[];
  const factory:any=(options:any,callback:any)=>{calls.push(options);const request=new EventEmitter() as any;request.end=()=>{const response=new EventEmitter() as any;response.statusCode=statusCode;response.headers=headers;callback(response);queueMicrotask(()=>{response.emit('data',Buffer.from(typeof responseBody==='string'?responseBody:JSON.stringify(responseBody)));response.emit('end');});};request.destroy=(error:any)=>request.emit('error',error);return request;};
  return {factory,calls};
}

describe('ConnectorTransportClient',()=>{
  it('sends one exact bounded request with fixed safe headers and validates correlation',async()=>{
    const io=requestFactory({version:'1',requestId:signed.requestId,status:'failed',error:{code:'CONNECTOR_BINDING_INVALID'}});
    const client=new ConnectorTransportClient({resolve:async()=>({ok:true,value:{addresses:['8.8.8.8'],lookup:jest.fn()}})} as any,io.factory);
    expect(await client.exchange(deployment,signed,new AbortController().signal,4500)).toEqual({ok:true,value:{version:'1',requestId:signed.requestId,status:'failed',error:{code:'CONNECTOR_BINDING_INVALID'}}});
    expect(io.calls).toHaveLength(1);expect(io.calls[0]).toMatchObject({method:'POST',hostname:'runtime.test',path:'/v1/connector/invocations',rejectUnauthorized:true,agent:false,headers:{authorization:'Bearer signed-proof','content-type':'application/json','accept-encoding':'identity','x-request-id':signed.requestId,'content-length':signed.bytes.length}});expect(io.calls[0].headers).not.toHaveProperty('content-encoding');
  });
  it.each([
    ['redirect',302,{'content-type':'application/json'},{}],
    ['encoding',200,{'content-type':'application/json','content-encoding':'gzip'},{}],
    ['non-json',200,{'content-type':'text/plain'},{}],
    ['mismatch',200,{'content-type':'application/json'},{version:'1',requestId:'other',status:'failed',error:{code:'CONNECTOR_BINDING_INVALID'}}],
  ])('fails closed for %s without retry',async(_n,status,headers,body)=>{
    const io=requestFactory(body,status,headers);const client=new ConnectorTransportClient({resolve:async()=>({ok:true,value:{addresses:['8.8.8.8'],lookup:jest.fn()}})} as any,io.factory);
    expect((await client.exchange(deployment,signed,new AbortController().signal,4500)).ok).toBe(false);expect(io.calls).toHaveLength(1);
  });
  it('fails before request for DNS rejection, oversize bytes, and abort',async()=>{
    const io=requestFactory({}); const rejected=new ConnectorTransportClient({resolve:async()=>({ok:false,code:'CONNECTOR_DESTINATION_REJECTED'})} as any,io.factory);
    expect(await rejected.exchange(deployment,signed,new AbortController().signal,4500)).toEqual({ok:false,code:'CONNECTOR_DESTINATION_REJECTED'});expect(io.calls).toHaveLength(0);
    const client=new ConnectorTransportClient({resolve:async()=>({ok:true,value:{addresses:['8.8.8.8'],lookup:jest.fn()}})} as any,io.factory);
    expect((await client.exchange({...deployment,maxRequestBytes:1},signed,new AbortController().signal,4500)).ok).toBe(false);
    const abort=new AbortController();abort.abort();expect(await client.exchange(deployment,signed,abort.signal,4500)).toEqual({ok:false,code:'CONNECTOR_TIMEOUT'});
  });
  it('rejects response bytes above the deployment cap',async()=>{
    const io=requestFactory('x'.repeat(20));const client=new ConnectorTransportClient({resolve:async()=>({ok:true,value:{addresses:['8.8.8.8'],lookup:jest.fn()}})} as any,io.factory);
    expect((await client.exchange({...deployment,maxResponseBytes:10},signed,new AbortController().signal,4500)).ok).toBe(false);
  });
  it('aborts hanging DNS before creating an HTTPS request',async()=>{
    const calls=jest.fn(); const network=new ConnectorNetworkPolicy(()=>new Promise(()=>undefined));
    const client=new ConnectorTransportClient(network,calls as any);const abort=new AbortController();const pending=client.exchange(deployment,signed,abort.signal,4500);abort.abort();
    await expect(pending).resolves.toEqual({ok:false,code:'CONNECTOR_TIMEOUT'});expect(calls).not.toHaveBeenCalled();
  });
  it('destroys one pending HTTPS request on caller abort and never retries',async()=>{
    const outgoing=new EventEmitter() as any;outgoing.end=jest.fn();outgoing.destroy=jest.fn();const factory=jest.fn(()=>outgoing);
    const client=new ConnectorTransportClient({resolve:async()=>({ok:true,value:{addresses:['8.8.8.8'],lookup:jest.fn()}})} as any,factory as any);const abort=new AbortController();const pending=client.exchange(deployment,signed,abort.signal,4500);await Promise.resolve();abort.abort();
    await expect(pending).resolves.toEqual({ok:false,code:'CONNECTOR_TIMEOUT'});expect(factory).toHaveBeenCalledTimes(1);expect(outgoing.destroy).toHaveBeenCalledTimes(1);
  });
  it('destroys a partially streaming response on caller abort and accepts no partial envelope',async()=>{
    const response=new EventEmitter() as any;response.statusCode=200;response.headers={'content-type':'application/json'};response.destroy=jest.fn();
    const outgoing=new EventEmitter() as any;outgoing.end=jest.fn(()=>{callback(response);response.emit('data',Buffer.from('{"version":"1"'));});outgoing.destroy=jest.fn();let callback:(response:any)=>void=()=>undefined;
    const factory=jest.fn((_options:any,handler:(response:any)=>void)=>{callback=handler;return outgoing;});
    const client=new ConnectorTransportClient({resolve:async()=>({ok:true,value:{addresses:['8.8.8.8'],lookup:jest.fn()}})} as any,factory as any);const abort=new AbortController();const pending=client.exchange(deployment,signed,abort.signal,4500);await Promise.resolve();abort.abort();
    await expect(pending).resolves.toEqual({ok:false,code:'CONNECTOR_TIMEOUT'});expect(factory).toHaveBeenCalledTimes(1);expect(outgoing.destroy).toHaveBeenCalledTimes(1);expect(response.destroy).toHaveBeenCalledTimes(1);
  });
});
