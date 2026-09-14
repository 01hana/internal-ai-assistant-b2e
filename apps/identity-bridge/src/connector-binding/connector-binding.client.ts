import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { lookup as dnsLookup } from 'node:dns/promises';
import {
  CONNECTOR_BINDING_MAX_REQUEST_BYTES,
  CONNECTOR_BINDING_MAX_RESPONSE_BYTES,
  type ConnectorBindingBootstrapResponseV1,
  parseConnectorBindingBootstrapResponseV1
} from '@internal-ai-assistant/connector-runtime-contract';
import { BridgeConfigService } from '../config/bridge-config.service';
import { ConnectorBindingDestinationPolicy } from './connector-binding-destination.policy';
import type { SignedConnectorBindingRequest } from './connector-binding-service-auth.signer';

type DnsAnswer = Readonly<{ address: string; family: number }>;
export type ConnectorBindingResolver = (hostname: string, signal: AbortSignal) => Promise<readonly DnsAnswer[]>;
export type ConnectorBindingRequestFactory = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void
) => ClientRequest;

type ClientOptions = Readonly<{
  allowTestLoopbackTls?: boolean;
  resolver?: ConnectorBindingResolver;
  requestFactory?: ConnectorBindingRequestFactory;
  setTimer?: (callback: () => void, milliseconds: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
}>;

export type ConnectorBindingClientResult =
  | Readonly<{ ok: true; value: ConnectorBindingBootstrapResponseV1 }>
  | Readonly<{ ok: false; code: 'CONNECTOR_REQUEST_INVALID' | 'CONNECTOR_DESTINATION_REJECTED' | 'CONNECTOR_UPSTREAM_FAILED' | 'CONNECTOR_RESPONSE_INVALID' | 'CONNECTOR_TIMEOUT' }>;

export class ConnectorBindingClient {
  private readonly resolver: ConnectorBindingResolver;
  private readonly requestFactory: ConnectorBindingRequestFactory;

  constructor(private readonly bridgeConfig: BridgeConfigService, private readonly options: ClientOptions = {}) {
    this.resolver = options.resolver ?? defaultResolver;
    this.requestFactory = options.requestFactory ?? httpsRequest as unknown as ConnectorBindingRequestFactory;
  }

  async validate(): Promise<boolean> {
    const config = this.bridgeConfig.configuration.connectorBinding;
    return !!config && new ConnectorBindingDestinationPolicy(config.destination, !!this.options.allowTestLoopbackTls).productionReady;
  }

  async exchange(signed: SignedConnectorBindingRequest, callerSignal?: AbortSignal): Promise<ConnectorBindingClientResult> {
    const config = this.bridgeConfig.configuration.connectorBinding;
    if (!config || signed.bytes.byteLength < 1 || signed.bytes.byteLength > CONNECTOR_BINDING_MAX_REQUEST_BYTES) return failure('CONNECTOR_REQUEST_INVALID');
    const uri = new URL(config.uri);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (callerSignal?.aborted) return failure('CONNECTOR_TIMEOUT');
    callerSignal?.addEventListener('abort', abort, { once: true });
    const timer = (this.options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds) as NodeJS.Timeout))(abort, 2_000);
    try {
      const answers = await raceAbort(this.resolver(uri.hostname, controller.signal), controller.signal);
      if (controller.signal.aborted) return failure('CONNECTOR_TIMEOUT');
      const policy = new ConnectorBindingDestinationPolicy(config.destination, !!this.options.allowTestLoopbackTls);
      const checked = policy.validate(answers.map((answer) => answer.address));
      if (!checked.ok) return checked;
      const pinnedAddress = checked.value[0]!;
      const family = pinnedAddress.includes(':') ? 6 : 4;
      const lookup: NonNullable<RequestOptions['lookup']> = (hostname, lookupOptions, callback) => {
        if (hostname !== uri.hostname) {
          callback(new Error('Pinned hostname mismatch'), '', 0);
          return;
        }
        if (typeof lookupOptions === 'object' && lookupOptions.all) callback(null, [{ address: pinnedAddress, family }]);
        else callback(null, pinnedAddress, family);
      };
      return await this.send(uri, signed, lookup, controller);
    } catch {
      return controller.signal.aborted ? failure('CONNECTOR_TIMEOUT') : failure('CONNECTOR_DESTINATION_REJECTED');
    } finally {
      (this.options.clearTimer ?? ((value) => clearTimeout(value)))(timer);
      callerSignal?.removeEventListener('abort', abort);
    }
  }

  private send(
    uri: URL,
    signed: SignedConnectorBindingRequest,
    lookup: NonNullable<RequestOptions['lookup']>,
    controller: AbortController
  ): Promise<ConnectorBindingClientResult> {
    return new Promise((resolve) => {
      let settled = false;
      let request: ReturnType<ConnectorBindingRequestFactory> | undefined;
      let response: IncomingMessage | undefined;
      const chunks: Buffer[] = [];
      const finish = (value: ConnectorBindingClientResult) => {
        if (settled) return;
        settled = true;
        chunks.length = 0;
        controller.signal.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onAbort = () => {
        response?.destroy?.();
        request?.destroy?.();
        finish(failure('CONNECTOR_TIMEOUT'));
      };
      try {
        request = this.requestFactory({
          protocol: 'https:', method: 'POST', hostname: uri.hostname, port: uri.port ? Number(uri.port) : 443,
          path: uri.pathname, rejectUnauthorized: true, servername: uri.hostname, agent: false, lookup,
          headers: {
            accept: 'application/json', 'accept-encoding': 'identity', 'content-type': 'application/json',
            'content-length': signed.bytes.byteLength, 'x-request-id': signed.requestId,
            authorization: `Bearer ${signed.proof}`
          }
        }, (incoming) => {
          response = incoming;
          const status = Number(incoming.statusCode);
          const contentType = String(incoming.headers?.['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
          const contentEncoding = incoming.headers?.['content-encoding'];
          if (status >= 300 && status < 400) {
            request?.destroy?.();
            finish(failure('CONNECTOR_DESTINATION_REJECTED'));
            return;
          }
          if (status < 200 || status >= 600) {
            request?.destroy?.();
            finish(failure('CONNECTOR_UPSTREAM_FAILED'));
            return;
          }
          if (contentType !== 'application/json' || contentEncoding !== undefined) {
            request?.destroy?.();
            finish(failure('CONNECTOR_DESTINATION_REJECTED'));
            return;
          }
          let total = 0;
          incoming.on('data', (chunk: Buffer | string) => {
            if (settled) return;
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += bytes.byteLength;
            if (total > CONNECTOR_BINDING_MAX_RESPONSE_BYTES) {
              request?.destroy?.();
              finish(failure('CONNECTOR_RESPONSE_INVALID'));
            } else chunks.push(bytes);
          });
          incoming.on('end', () => {
            if (settled) return;
            const parsed = parseConnectorBindingBootstrapResponseV1(Buffer.concat(chunks), signed.requestId);
            if (!parsed.ok) finish(failure('CONNECTOR_RESPONSE_INVALID'));
            else if (status === 200 || ('status' in parsed.value && parsed.value.status === 'failed')) finish(Object.freeze({ ok: true, value: parsed.value }));
            else finish(failure('CONNECTOR_UPSTREAM_FAILED'));
          });
          incoming.on('error', () => finish(controller.signal.aborted ? failure('CONNECTOR_TIMEOUT') : failure('CONNECTOR_UPSTREAM_FAILED')));
        });
        controller.signal.addEventListener('abort', onAbort, { once: true });
        request.on('error', () => finish(controller.signal.aborted ? failure('CONNECTOR_TIMEOUT') : failure('CONNECTOR_UPSTREAM_FAILED')));
        request.end(signed.bytes);
      } catch {
        finish(controller.signal.aborted ? failure('CONNECTOR_TIMEOUT') : failure('CONNECTOR_UPSTREAM_FAILED'));
      }
    });
  }
}

async function defaultResolver(hostname: string, _signal: AbortSignal): Promise<readonly DnsAnswer[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); }
    );
  });
}

function failure(code: Extract<ConnectorBindingClientResult, { ok: false }>['code']): ConnectorBindingClientResult {
  return Object.freeze({ ok: false, code });
}
