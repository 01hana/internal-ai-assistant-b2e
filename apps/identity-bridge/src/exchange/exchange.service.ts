import { Injectable } from '@nestjs/common';
import { CanonicalTokenIssuer } from '../signing/canonical-token.issuer';
import { IdentityAdmissionService } from '../idx/identity-admission.service';
import { IdxMenuDetailValidator } from '../idx/menu-detail.validator';
import { IdxPermissionNormalizer } from '../idx/permission-normalizer';
import { ScopeProjector } from '../idx/scope-projector';
import { MenuDetailTransport } from '../idx/transport/menu-detail.transport';
import { IdxTransportError } from '../idx/transport/transport.error';
import { ExchangeIdentityDeniedError, ExchangeUnavailableError } from './redaction';
import { ConnectorBindingCoordinator } from '../connector-binding/connector-binding.coordinator';
import { LocalConnectorDiagnostics } from '../diagnostics/local-connector-diagnostics';

export type ExchangeResult = Readonly<{
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: 300;
  connectorContextRef?: string;
  connectorContextExpiresIn?: number;
}>;

@Injectable()
export class ExchangeService {
  constructor(
    private readonly transport: MenuDetailTransport,
    private readonly validator: IdxMenuDetailValidator,
    private readonly admission: IdentityAdmissionService,
    private readonly normalizer: IdxPermissionNormalizer,
    private readonly projector: ScopeProjector,
    private readonly issuer: CanonicalTokenIssuer,
    private readonly connectorBinding?: ConnectorBindingCoordinator,
    private readonly diagnostics?: Pick<LocalConnectorDiagnostics, 'emit'>
  ) {}

  async exchange(nativeAccessToken: string, publicExchangeRequestId?: string): Promise<ExchangeResult> {
    const startedAt = Date.now();
    const metadata = { publicExchangeRequestId };
    this.diagnostics?.emit('EXCHANGE_REQUEST_ACCEPTED', 'SUCCEEDED', metadata);
    let body: unknown;
    this.diagnostics?.emit('MENUDETAIL_REQUEST_STARTED', 'STARTED', metadata);
    try {
      body = (await this.transport.execute(nativeAccessToken)).body;
      this.diagnostics?.emit('MENUDETAIL_REQUEST_SUCCEEDED', 'SUCCEEDED', metadata);
    } catch (error) {
      const failureCategory = error instanceof IdxTransportError ? 'IDX_TRANSPORT_FAILED' : 'UNEXPECTED_TRANSPORT_FAILURE';
      this.diagnostics?.emit('MENUDETAIL_REQUEST_FAILED', 'FAILED', { ...metadata, failureCategory });
      this.diagnostics?.emit('EXCHANGE_FAILED', 'FAILED', { ...metadata, failureCategory, durationMs: Date.now() - startedAt });
      if (error instanceof IdxTransportError) throw error;
      throw new ExchangeUnavailableError();
    }

    let menus: ReturnType<IdxMenuDetailValidator['validate']>;
    try { menus = this.validator.validate(body); }
    catch {
      this.diagnostics?.emit('EXCHANGE_FAILED', 'FAILED', { ...metadata, failureCategory: 'MENUDETAIL_SEMANTIC_VALIDATION_FAILED', durationMs: Date.now() - startedAt });
      throw new ExchangeUnavailableError();
    }

    let identity: ReturnType<IdentityAdmissionService['admit']>;
    try {
      identity = this.admission.admit(menus, nativeAccessToken);
      this.diagnostics?.emit('IDENTITY_ADMISSION_SUCCEEDED', 'SUCCEEDED', metadata);
    } catch {
      this.diagnostics?.emit('IDENTITY_ADMISSION_FAILED', 'FAILED', { ...metadata, failureCategory: 'IDENTITY_ADMISSION_REJECTED' });
      this.diagnostics?.emit('EXCHANGE_FAILED', 'FAILED', { ...metadata, failureCategory: 'IDENTITY_ADMISSION_REJECTED', durationMs: Date.now() - startedAt });
      throw new ExchangeIdentityDeniedError();
    }

    try {
      const permissionScopes = this.projector.project(this.normalizer.normalize(menus));
      const binding = this.connectorBinding
        ? await this.connectorBinding.bootstrap({ nativeAccessToken, acceptedIdentity: identity }, publicExchangeRequestId)
        : Object.freeze({ ok: true as const });
      if (!binding.ok) throw new ExchangeUnavailableError();
      const issued = await this.issuer.issue(Object.freeze({ identity, permissionScopes }));
      this.diagnostics?.emit('CANONICAL_TOKEN_ISSUED', 'SUCCEEDED', metadata);
      this.diagnostics?.emit('EXCHANGE_COMPLETED', 'SUCCEEDED', { ...metadata, durationMs: Date.now() - startedAt });
      return Object.freeze({
        accessToken: issued.accessToken, tokenType: 'Bearer', expiresIn: 300,
        ...('connectorContextRef' in binding ? {
          connectorContextRef: binding.connectorContextRef,
          connectorContextExpiresIn: binding.expiresIn
        } : {})
      });
    } catch {
      this.diagnostics?.emit('EXCHANGE_FAILED', 'FAILED', { ...metadata, failureCategory: 'POST_ADMISSION_EXCHANGE_FAILED', durationMs: Date.now() - startedAt });
      throw new ExchangeUnavailableError();
    }
  }
}
