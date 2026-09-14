import { ConnectorNetworkPolicy } from '../../src/connectors/productized-business/connector-network-policy';

describe('ConnectorNetworkPolicy', () => {
  it('validates every answer and pins one deterministic address', async () => {
    const policy=new ConnectorNetworkPolicy(async()=>[{address:'8.8.8.8',family:4},{address:'1.1.1.1',family:4}]);
    const result=await policy.resolve('runtime.test',{mode:'public_only',allowedCidrs:[]},new AbortController().signal);
    expect(result.ok).toBe(true); if(!result.ok)return; expect(result.value.addresses).toEqual(['1.1.1.1','8.8.8.8']);
    result.value.lookup('runtime.test',{},(error,address)=>expect([error,address]).toEqual([null,'1.1.1.1']));
    result.value.lookup('other.test',{},(error)=>expect(error).toBeInstanceOf(Error));
  });
  it.each(['127.0.0.1','169.254.169.254','::1','fd00:ec2::254','10.0.0.1','::ffff:127.0.0.1'])('rejects unsafe public answer %s',async(address)=>{
    await expect(new ConnectorNetworkPolicy(async()=>[{address,family:address.includes(':')?6:4}]).resolve('runtime.test',{mode:'public_only',allowedCidrs:[]},new AbortController().signal)).resolves.toEqual({ok:false,code:'CONNECTOR_DESTINATION_REJECTED'});
  });
  it('allows only explicit private CIDRs and rejects mixed answer sets',async()=>{
    const permitted=new ConnectorNetworkPolicy(async()=>[{address:'10.4.5.6',family:4}]);
    expect((await permitted.resolve('runtime.test',{mode:'allowlisted_networks',allowedCidrs:['10.4.0.0/16']},new AbortController().signal)).ok).toBe(true);
    const mixed=new ConnectorNetworkPolicy(async()=>[{address:'10.4.5.6',family:4},{address:'8.8.8.8',family:4}]);
    expect(await mixed.resolve('runtime.test',{mode:'allowlisted_networks',allowedCidrs:['10.4.0.0/16']},new AbortController().signal)).toEqual({ok:false,code:'CONNECTOR_DESTINATION_REJECTED'});
  });
  it('admits loopback only through a constructor-only TLS test seam and honors cancellation',async()=>{
    expect((await new ConnectorNetworkPolicy(async()=>[{address:'127.0.0.1',family:4}],true).resolve('runtime.test',{mode:'public_only',allowedCidrs:[]},new AbortController().signal)).ok).toBe(true);
    expect((await new ConnectorNetworkPolicy(async()=>[{address:'::1',family:6}],true).resolve('runtime.test',{mode:'public_only',allowedCidrs:[]},new AbortController().signal)).ok).toBe(true);
    const abort=new AbortController(); abort.abort();
    expect(await new ConnectorNetworkPolicy(async()=>[{address:'8.8.8.8',family:4}]).resolve('runtime.test',{mode:'public_only',allowedCidrs:[]},abort.signal)).toEqual({ok:false,code:'CONNECTOR_TIMEOUT'});
  });
  it.each(['10.0.0.1','192.168.1.1','fd12:3456::10','169.254.169.254','fd00:ec2::254'])('does not let the loopback-only test seam admit private or metadata address %s',async(address)=>{
    expect(await new ConnectorNetworkPolicy(async()=>[{address,family:address.includes(':')?6:4}],true).resolve('runtime.test',{mode:'public_only',allowedCidrs:[]},new AbortController().signal)).toEqual({ok:false,code:'CONNECTOR_DESTINATION_REJECTED'});
  });
});
