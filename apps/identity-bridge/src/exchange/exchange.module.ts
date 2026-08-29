import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { BridgeConfigService } from '../config/bridge-config.service';
import { ConfigurationModule } from '../config/configuration.module';
import { BridgeHealthModule } from '../health/bridge-health.module';
import { BridgeReadinessRegistry } from '../health/readiness.service';
import { IdentityAdmissionService } from '../idx/identity-admission.service';
import { IdxTransportModule } from '../idx/idx-transport.module';
import { IdxMenuDetailValidator } from '../idx/menu-detail.validator';
import { IdxPermissionNormalizer } from '../idx/permission-normalizer';
import { ScopeProjector } from '../idx/scope-projector';
import { BridgeDestinationPolicy } from '../idx/transport/destination-policy';
import { MenuDetailTransport } from '../idx/transport/menu-detail.transport';
import { JwksModule } from '../jwks/jwks.module';
import { JwksService } from '../jwks/jwks.service';
import { ActiveKeyResolver } from '../signing/active-key.resolver';
import { CanonicalTokenIssuer } from '../signing/canonical-token.issuer';
import { ExchangeController } from './exchange.controller';
import { ExchangeService } from './exchange.service';

@Injectable()
export class ExchangeReadinessInitializer implements OnModuleInit {
  constructor(
    private readonly config: BridgeConfigService,
    private readonly readiness: BridgeReadinessRegistry,
    private readonly transport: MenuDetailTransport,
    private readonly validator: IdxMenuDetailValidator,
    private readonly admission: IdentityAdmissionService,
    private readonly normalizer: IdxPermissionNormalizer,
    private readonly projector: ScopeProjector,
    private readonly signing: ActiveKeyResolver,
    private readonly jwks: JwksService,
    private readonly exchange: ExchangeService
  ) {}

  async onModuleInit(): Promise<void> {
    for (const dependency of ['idxTransport', 'idxSemantics', 'signing', 'jwks', 'exchange'] as const) this.readiness.setReady(dependency, false);
    if (!this.config.isValid) return;

    try {
      const configuration = this.config.configuration;
      new URL(configuration.idxMenuDetailUri);
      new BridgeDestinationPolicy(configuration.destination);
      if (typeof this.transport.execute !== 'function') return;
      this.readiness.setReady('idxTransport', true);
    } catch { return; }

    if (![this.validator.validate, this.admission.admit, this.normalizer.normalize, this.projector.project].every((capability) => typeof capability === 'function')) return;
    this.readiness.setReady('idxSemantics', true);

    try { await this.signing.resolve(); this.readiness.setReady('signing', true); }
    catch { return; }

    try { await this.jwks.document(); this.readiness.setReady('jwks', true); }
    catch { return; }

    if (typeof this.exchange.exchange !== 'function') return;
    this.readiness.setReady('exchange', true);
  }
}

@Module({
  imports: [ConfigurationModule, BridgeHealthModule, IdxTransportModule, JwksModule],
  controllers: [ExchangeController],
  providers: [
    IdxMenuDetailValidator, IdentityAdmissionService, IdxPermissionNormalizer, ScopeProjector,
    { provide: ActiveKeyResolver, useFactory: (config: BridgeConfigService) => new ActiveKeyResolver(config), inject: [BridgeConfigService] },
    { provide: CanonicalTokenIssuer, useFactory: (config: BridgeConfigService, keys: ActiveKeyResolver) => new CanonicalTokenIssuer(config, keys), inject: [BridgeConfigService, ActiveKeyResolver] },
    ExchangeService, ExchangeReadinessInitializer
  ],
  exports: [ExchangeService]
})
export class ExchangeModule {}
