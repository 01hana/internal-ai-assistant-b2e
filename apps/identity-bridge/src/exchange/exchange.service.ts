import { Injectable } from '@nestjs/common';
import { CanonicalTokenIssuer } from '../signing/canonical-token.issuer';
import { IdentityAdmissionService } from '../idx/identity-admission.service';
import { IdxMenuDetailValidator } from '../idx/menu-detail.validator';
import { IdxPermissionNormalizer } from '../idx/permission-normalizer';
import { ScopeProjector } from '../idx/scope-projector';
import { MenuDetailTransport } from '../idx/transport/menu-detail.transport';
import { IdxTransportError } from '../idx/transport/transport.error';
import { ExchangeIdentityDeniedError, ExchangeUnavailableError } from './redaction';

export type ExchangeResult = Readonly<{ accessToken: string; tokenType: 'Bearer'; expiresIn: 300 }>;

@Injectable()
export class ExchangeService {
  constructor(
    private readonly transport: MenuDetailTransport,
    private readonly validator: IdxMenuDetailValidator,
    private readonly admission: IdentityAdmissionService,
    private readonly normalizer: IdxPermissionNormalizer,
    private readonly projector: ScopeProjector,
    private readonly issuer: CanonicalTokenIssuer
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
      const issued = await this.issuer.issue(Object.freeze({ identity, permissionScopes }));
      return Object.freeze({ accessToken: issued.accessToken, tokenType: 'Bearer', expiresIn: 300 });
    } catch { throw new ExchangeUnavailableError(); }
  }
}
