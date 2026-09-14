import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SignJWT, type JWK, KeyLike } from 'jose';
import type { ConnectorInvocationRequestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import type { ConnectorDeployment } from './connector-deployment.registry';

type SigningKey = Readonly<{ kid: string; privateKey: KeyLike }>;
type SigningProfile = Readonly<{ profileKey: string; typ: 'assistant-connector-service+jwt'; subject: string; keyDomain: string; key: SigningKey }>;
type SignerOptions = Readonly<{ now?: () => number; uuid?: () => string; serialize?: (value: ConnectorInvocationRequestV1) => string }>;
type SignedConnectorInvocation = Readonly<{ bytes: Buffer; proof: string; requestId: string }>;
const PROFILE_KEYS = new Set(['profileKey','typ','subject','keyDomain','keys']);
const KEY_KEYS = new Set(['kid','status','publicJwk','privateKeyReference']);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function invalid(): never { throw new Error('CONNECTOR_CONFIGURATION_INVALID'); }
function exact(value: Record<string,unknown>, keys:Set<string>) { if(Object.keys(value).some(k=>!keys.has(k)) || [...keys].some(k=>!(k in value))) invalid(); }
function identifier(v:unknown): string { if(typeof v!=='string'||!ID.test(v)||v.includes('*')) invalid(); return v; }
function canonicalJwk(jwk:JWK): string { return JSON.stringify({kty:jwk.kty,n:jwk.n,e:jwk.e}); }

export class ConnectorServiceAuthSigner {
  private constructor(private readonly profiles: ReadonlyMap<string,SigningProfile>, private readonly issuer:string, private readonly options:SignerOptions) {}
  static fromConfiguration(json:string,issuer:string,options:SignerOptions={}): ConnectorServiceAuthSigner {
    if(typeof issuer!=='string'||!ID.test(issuer)||!issuer.includes(':')) invalid();
    let raw:unknown; try{raw=JSON.parse(json);}catch{invalid();}
    if(!Array.isArray(raw)||raw.length===0||raw.length>128) invalid();
    const profiles=new Map<string,SigningProfile>(); const domains=new Set<string>(); const materials=new Set<string>();
    for(const entry of raw){
      if(!entry||typeof entry!=='object'||Array.isArray(entry))invalid(); const p=entry as Record<string,unknown>; exact(p,PROFILE_KEYS);
      const profileKey=identifier(p.profileKey), subject=identifier(p.subject), keyDomain=identifier(p.keyDomain);
      if(p.typ!=='assistant-connector-service+jwt'||/identity|bridge|bootstrap/i.test(keyDomain)||profiles.has(profileKey)||domains.has(keyDomain)||!Array.isArray(p.keys)||p.keys.length===0)invalid();
      domains.add(keyDomain); let active:SigningKey|undefined;
      const kids=new Set<string>();
      for(const item of p.keys){
        if(!item||typeof item!=='object'||Array.isArray(item))invalid(); const k=item as Record<string,unknown>;
        if(Object.keys(k).some(name=>!KEY_KEYS.has(name))||!['kid','status','publicJwk'].every(name=>name in k))invalid();
        const kid=identifier(k.kid); if(kids.has(kid)||!['published','active','retiring'].includes(String(k.status))||!k.publicJwk||typeof k.publicJwk!=='object'||Array.isArray(k.publicJwk))invalid();kids.add(kid);
        const pub=k.publicJwk as JWK; if(pub.kty!=='RSA'||typeof pub.n!=='string'||typeof pub.e!=='string'||['d','p','q','dp','dq','qi','oth'].some(name=>name in pub))invalid();
        const fingerprint=canonicalJwk(pub); if(materials.has(fingerprint))invalid(); materials.add(fingerprint);
        if(k.status==='active'){
          if(active||typeof k.privateKeyReference!=='string'||!k.privateKeyReference.startsWith('file:///'))invalid();
          let path:string; try{path=fileURLToPath(k.privateKeyReference);}catch{invalid();}
          const stat=lstatSync(path); if(!stat.isFile()||stat.isSymbolicLink())invalid();
          const pem=readFileSync(path,'utf8');
          active={kid,privateKey: undefined as unknown as KeyLike};
          (active as {privateKey:KeyLike}).privateKey = importPrivateKeySync(pem);
          const exported=exportPublicJwkSync(active.privateKey);
          if(canonicalJwk(exported)!==fingerprint)invalid();
        } else if(k.privateKeyReference!==undefined) invalid();
      }
      if(!active)invalid(); profiles.set(profileKey,Object.freeze({profileKey,typ:'assistant-connector-service+jwt',subject,keyDomain,key:Object.freeze(active)}));
    }
    return new ConnectorServiceAuthSigner(profiles,issuer,options);
  }
  hasProfile(profileKey:string):boolean{return this.profiles.has(profileKey);}
  async sign(request:ConnectorInvocationRequestV1,deployment:ConnectorDeployment):Promise<{ok:true;value:SignedConnectorInvocation}|{ok:false;code:'CONNECTOR_AUTH_FAILED'|'CONNECTOR_REQUEST_INVALID'}>{
    const c=request.trustedContext;
    if(c.customerId!==deployment.customerId||c.integrationId!==deployment.integrationId||c.hostApp!==deployment.hostApp||c.connectorKey!==deployment.connectorKey||c.connectorInstanceId!==deployment.connectorInstanceId)return {ok:false,code:'CONNECTOR_AUTH_FAILED'};
    const profile=this.profiles.get(deployment.serviceAuthProfileKey); if(!profile)return {ok:false,code:'CONNECTOR_AUTH_FAILED'};
    const serialized=(this.options.serialize??JSON.stringify)(request); const bytes=Buffer.from(serialized,'utf8');
    if(bytes.length<1||bytes.length>deployment.maxRequestBytes)return {ok:false,code:'CONNECTOR_REQUEST_INVALID'};
    const now=(this.options.now??(()=>Math.floor(Date.now()/1000)))();
    const proof=await new SignJWT({proof_version:1,customer_id:c.customerId,integration_id:c.integrationId,host_app:c.hostApp,connector_key:c.connectorKey,connector_instance_id:c.connectorInstanceId,operation:request.operation.key,operation_version:request.operation.version,request_id:request.requestId,body_sha256:createHash('sha256').update(bytes).digest('base64url')})
      .setProtectedHeader({alg:'RS256',kid:profile.key.kid,typ:profile.typ}).setIssuer(this.issuer).setSubject(profile.subject)
      .setAudience(`urn:assistant:connector:${c.customerId}:${c.integrationId}:${c.hostApp}:${c.connectorKey}:${c.connectorInstanceId}`)
      .setIssuedAt(now).setNotBefore(now).setExpirationTime(now+30).setJti((this.options.uuid??randomUUID)()).sign(profile.key.privateKey);
    return {ok:true,value:Object.freeze({bytes,proof,requestId:request.requestId})};
  }
}

// jose's PKCS#8 import is asynchronous by type but returns a settled promise; central
// startup performs the only synchronous file access and retains no PEM text.
function importPrivateKeySync(pem:string):KeyLike {
  const { createPrivateKey } = require('node:crypto') as typeof import('node:crypto');
  return createPrivateKey(pem) as unknown as KeyLike;
}
function exportPublicJwkSync(key:KeyLike):JWK {
  const { createPublicKey } = require('node:crypto') as typeof import('node:crypto');
  return createPublicKey(key as never).export({format:'jwk'}) as JWK;
}
