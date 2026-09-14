import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ConnectorAddressPolicy } from './connector-deployment.registry';

type Answer=Readonly<{address:string;family:number}>;
export type CentralDnsResolver=(hostname:string,signal:AbortSignal)=>Promise<readonly Answer[]>;
export type CentralPinnedLookup=(hostname:string,options:Readonly<{all?:boolean}>,callback:(error:Error|null,address?:string|readonly Answer[],family?:number)=>void)=>void;
export type CentralPinResult=Readonly<{ok:true;value:Readonly<{addresses:readonly string[];lookup:CentralPinnedLookup}>}>|Readonly<{ok:false;code:'CONNECTOR_DESTINATION_REJECTED'|'CONNECTOR_TIMEOUT'}>;
type Ip=Readonly<{family:4|6;value:bigint;canonical:string}>;
const ALWAYS=['0.0.0.0/8','100.64.0.0/10','169.254.0.0/16','192.0.0.0/24','192.0.2.0/24','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4','::/128','fe80::/10','ff00::/8','2001:db8::/32','fd00:ec2::254/128'];
const LOOPBACK=['127.0.0.0/8','::1/128']; const PRIVATE=['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','fc00::/7'];

export class ConnectorNetworkPolicy {
  constructor(private readonly resolver:CentralDnsResolver=defaultResolver,private readonly allowTestLoopbackTls=false){}
  async resolve(hostname:string,policy:ConnectorAddressPolicy,signal:AbortSignal):Promise<CentralPinResult>{
    if(signal.aborted)return timeout();
    try{
      const answers=await raceAbort(this.resolver(hostname,signal),signal); if(signal.aborted)return timeout();
      if(answers.length<1||answers.length>64)return rejected();
      const parsed=answers.map(a=>parseIp(a.address));if(parsed.some(v=>!v))return rejected();
      const loopback=this.allowTestLoopbackTls?[]:LOOPBACK;
      const denied=policy.mode==='public_only'?[...ALWAYS,...loopback,...PRIVATE]:[...ALWAYS,...loopback];
      const allow=policy.allowedCidrs.map(parseCidr);if(allow.some(v=>!v))return rejected();
      for(const ip of parsed as Ip[]){if(denied.some(c=>contains(c,ip)))return rejected();if(policy.mode==='allowlisted_networks'&&!allow.some(c=>c&&containsParsed(c,ip)))return rejected();}
      const addresses=Object.freeze((parsed as Ip[]).map(v=>v.canonical).sort()); const address=addresses[0]!; const family=isIP(address) as 4|6;
      const lookup:CentralPinnedLookup=(requested,options,cb)=>{if(requested!==hostname){cb(new Error('Pinned hostname mismatch'));return;}if(options.all)cb(null,Object.freeze([{address,family}]));else cb(null,address,family);};
      return Object.freeze({ok:true,value:Object.freeze({addresses,lookup})});
    }catch{return signal.aborted?timeout():rejected();}
  }
}
async function defaultResolver(hostname:string,_signal:AbortSignal):Promise<readonly Answer[]>{return dnsLookup(hostname,{all:true,verbatim:true});}
async function raceAbort<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{const abort=()=>reject(new Error('aborted'));signal.addEventListener('abort',abort,{once:true});promise.then(v=>{signal.removeEventListener('abort',abort);resolve(v);},e=>{signal.removeEventListener('abort',abort);reject(e);});});}
function rejected():CentralPinResult{return Object.freeze({ok:false,code:'CONNECTOR_DESTINATION_REJECTED'});}
function timeout():CentralPinResult{return Object.freeze({ok:false,code:'CONNECTOR_TIMEOUT'});}
function parseIp(text:string):Ip|undefined{const family=isIP(text);if(family===4){const value=v4(text);return value===undefined?undefined:{family:4,value,canonical:v4text(value)};}if(family!==6)return;let n=text.toLowerCase();if(n.includes('.')){const i=n.lastIndexOf(':');const value=v4(n.slice(i+1));if(value===undefined)return;n=`${n.slice(0,i+1)}${Number(value>>16n).toString(16)}:${Number(value&65535n).toString(16)}`;}const halves=n.split('::');if(halves.length>2)return;const left=halves[0]?halves[0].split(':'):[],right=halves[1]?halves[1].split(':'):[];const zeros=halves.length===2?8-left.length-right.length:0;if(halves.length===1?left.length!==8:zeros<1)return;const groups=halves.length===2?[...left,...Array(zeros).fill('0'),...right]:left;if(groups.length!==8||groups.some(g=>!/^[0-9a-f]{1,4}$/.test(g)))return;const value=groups.reduce((a,g)=>(a<<16n)|BigInt(parseInt(g,16)),0n);if(value>>32n===0xffffn){const mapped=value&0xffffffffn;return{family:4,value:mapped,canonical:v4text(mapped)};}return{family:6,value,canonical:n};}
function v4(text:string):bigint|undefined{const parts=text.split('.');if(parts.length!==4)return;let value=0n;for(const part of parts){if(!/^(?:0|[1-9][0-9]{0,2})$/.test(part)||Number(part)>255)return;value=(value<<8n)|BigInt(part);}return value;}
function v4text(v:bigint):string{return[24n,16n,8n,0n].map(s=>Number(v>>s&255n)).join('.');}
type Cidr={family:4|6;network:bigint;prefix:number};
function parseCidr(text:string):Cidr|undefined{const [address,prefixText,...extra]=text.split('/');if(extra.length||!address||!/^\d{1,3}$/.test(prefixText??''))return;const ip=parseIp(address);if(!ip)return;let prefix=Number(prefixText);if(isIP(address)===6&&ip.family===4){if(prefix<96||prefix>128)return;prefix-=96;}const bits=ip.family===4?32:128;if(prefix<0||prefix>bits)return;const shift=BigInt(bits-prefix);return{family:ip.family,network:shift?(ip.value>>shift)<<shift:ip.value,prefix};}
function contains(text:string,ip:Ip):boolean{const cidr=parseCidr(text);return!!cidr&&containsParsed(cidr,ip);}
function containsParsed(cidr:Cidr,ip:Ip):boolean{if(cidr.family!==ip.family)return false;const shift=BigInt((ip.family===4?32:128)-cidr.prefix);return ip.value>>shift===cidr.network>>shift;}
