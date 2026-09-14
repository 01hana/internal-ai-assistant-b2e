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
    private readonly connectorBinding?: ConnectorBindingCoordinator
  ) {}

  async exchange(nativeAccessToken: string): Promise<ExchangeResult> {
    let body: unknown;
    try {
      body = (await this.transport.execute(nativeAccessToken)).body;
    } catch (error) {
      if (error instanceof IdxTransportError) throw error;
      throw new ExchangeUnavailableError();
    }

    let menus: ReturnType<IdxMenuDetailValidator['validate']>;
    try { menus = this.validator.validate(body); }
    catch { throw new ExchangeUnavailableError(); }

    let identity: ReturnType<IdentityAdmissionService['admit']>;
    try { identity = this.admission.admit(menus, nativeAccessToken); }
    catch { throw new ExchangeIdentityDeniedError(); }

    try {
      const permissionScopes = this.projector.project(this.normalizer.normalize(menus));
      const binding = this.connectorBinding
        ? await this.connectorBinding.bootstrap({ nativeAccessToken, acceptedIdentity: identity })
        : Object.freeze({ ok: true as const });
      if (!binding.ok) throw new ExchangeUnavailableError();
      const issued = await this.issuer.issue(Object.freeze({ identity, permissionScopes }));
      return Object.freeze({
        accessToken: issued.accessToken, tokenType: 'Bearer', expiresIn: 300,
        ...('connectorContextRef' in binding ? {
          connectorContextRef: binding.connectorContextRef,
          connectorContextExpiresIn: binding.expiresIn
        } : {})
      });
    } catch { throw new ExchangeUnavailableError(); }
  }
}
