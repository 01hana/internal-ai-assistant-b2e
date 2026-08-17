import { Module } from '@nestjs/common';
import { GatewayIdentityAuditWriter } from './audit/gateway-identity-audit.writer';
import { GatewayBackendClient } from './backend-client/gateway-backend-client.service';
import { GatewayAssistantController } from './operations/gateway-assistant.controller';
import { GatewayTrustChainHandler } from './backend-client/gateway-trust-chain.handler';
import { GatewayConfigModule } from './config/gateway-config.module';
import { GatewayConfigService } from './config/gateway-config.service';
import type { PrismaClient } from './generated/prisma/client';
import { GatewayHealthModule } from './health/gateway-health.module';
import { InternalIdentityTokenIssuer } from './identity/internal-identity-token-issuer.service';
import { CanonicalIdentityResolver } from './integration-registry/canonical-identity-resolver.service';
import { CandidateTrustProfileResolver } from './integration-registry/candidate-trust-profile.resolver';
import { IntegrationBindingRepository } from './integration-registry/integration-binding.repository';
import { TrustProfileCache } from './integration-registry/trust-profile-cache';
import { TrustProfileRepository } from './integration-registry/trust-profile.repository';
import { TrustProfileRuntimeReadiness } from './integration-registry/trust-profile-runtime-readiness.service';
import { JwksModule } from './jwks/jwks.module';
import { ActiveSigningKeyResolver } from './signing/active-signing-key-resolver';
import { GATEWAY_PRISMA_CLIENT, GatewaySigningKeyPersistenceModule } from './signing/gateway-signing-key-persistence.module';
import { GatewaySigningKeyRepository } from './signing/gateway-signing-key.repository';
import { SigningKeyProvider } from './signing/signing-key-provider';
import { HardenedJwksTransport } from './upstream-auth/jwks-transport.adapter';
import { MultiProfileUpstreamTokenVerifier } from './upstream-auth/multi-profile-upstream-token-verifier';
import { ProfileScopedVerifier } from './upstream-auth/profile-scoped-verifier';
import { RoutingMetadataParser } from './upstream-auth/routing-metadata.parser';
import { UpstreamAuthTelemetry } from './upstream-auth/upstream-auth-telemetry';

@Module({
  imports: [GatewayConfigModule, GatewayHealthModule, JwksModule, GatewaySigningKeyPersistenceModule],
  controllers: [GatewayAssistantController],
  providers: [
    {
      provide: TrustProfileRepository,
      inject: [GATEWAY_PRISMA_CLIENT],
      useFactory: (client: PrismaClient) => new TrustProfileRepository(client)
    },
    {
      provide: CandidateTrustProfileResolver,
      inject: [TrustProfileCache],
      useFactory: (cache: TrustProfileCache) => new CandidateTrustProfileResolver(cache)
    },
    {
      provide: TrustProfileCache,
      inject: [TrustProfileRepository],
      useFactory: (repository: TrustProfileRepository) => new TrustProfileCache({ repository })
    },
    {
      provide: TrustProfileRuntimeReadiness,
      inject: [TrustProfileRepository],
      useFactory: (repository: TrustProfileRepository) => new TrustProfileRuntimeReadiness(repository)
    },
    RoutingMetadataParser,
    HardenedJwksTransport,
    {
      provide: ProfileScopedVerifier,
      inject: [HardenedJwksTransport],
      useFactory: (transport: HardenedJwksTransport) => new ProfileScopedVerifier({ transport })
    },
    {
      provide: UpstreamAuthTelemetry,
      inject: [GatewayIdentityAuditWriter],
      useFactory: (writer: GatewayIdentityAuditWriter) => new UpstreamAuthTelemetry(writer)
    },
    {
      provide: MultiProfileUpstreamTokenVerifier,
      inject: [RoutingMetadataParser, CandidateTrustProfileResolver, ProfileScopedVerifier, GatewayConfigService, TrustProfileRuntimeReadiness, UpstreamAuthTelemetry],
      useFactory: async (
        parser: RoutingMetadataParser,
        candidateResolver: CandidateTrustProfileResolver,
        profileVerifier: ProfileScopedVerifier,
        config: GatewayConfigService,
        readiness: TrustProfileRuntimeReadiness,
        telemetry: UpstreamAuthTelemetry
      ) => {
        await readiness.assertReady();
        return new MultiProfileUpstreamTokenVerifier({
          parser,
          candidateResolver,
          profileVerifier,
          telemetry,
          clockToleranceSeconds: config.config.upstreamClockToleranceSeconds
        });
      }
    },
    {
      provide: IntegrationBindingRepository,
      inject: [GATEWAY_PRISMA_CLIENT],
      useFactory: (client: PrismaClient) => new IntegrationBindingRepository(client)
    },
    {
      provide: GatewayIdentityAuditWriter,
      inject: [GATEWAY_PRISMA_CLIENT],
      useFactory: (client: PrismaClient) => new GatewayIdentityAuditWriter(client)
    },
    {
      provide: CanonicalIdentityResolver,
      inject: [IntegrationBindingRepository, GatewayIdentityAuditWriter],
      useFactory: (repository: IntegrationBindingRepository, auditWriter: GatewayIdentityAuditWriter) => new CanonicalIdentityResolver(repository, auditWriter)
    },
    SigningKeyProvider,
    {
      provide: ActiveSigningKeyResolver,
      inject: [GatewaySigningKeyRepository, SigningKeyProvider],
      useFactory: (repository: GatewaySigningKeyRepository, signingKeyProvider: SigningKeyProvider) => new ActiveSigningKeyResolver(repository, signingKeyProvider)
    },
    {
      provide: InternalIdentityTokenIssuer,
      inject: [GatewayConfigService, ActiveSigningKeyResolver],
      useFactory: (config: GatewayConfigService, activeKeyResolver: ActiveSigningKeyResolver) => new InternalIdentityTokenIssuer({
        internalIssuer: config.config.internalIssuer,
        internalAudience: config.config.internalAudience,
        internalTokenTtlSeconds: config.config.internalTokenTtlSeconds
      }, activeKeyResolver)
    },
    {
      provide: GatewayBackendClient,
      inject: [GatewayConfigService, InternalIdentityTokenIssuer],
      useFactory: (config: GatewayConfigService, internalTokenIssuer: InternalIdentityTokenIssuer) => new GatewayBackendClient({
        backendBaseUrl: config.config.backendBaseUrl,
        timeoutMilliseconds: 5000,
        internalTokenIssuer,
        fetch: (url, init) => globalThis.fetch(url, init),
        createTimeoutSignal: (milliseconds) => AbortSignal.timeout(milliseconds),
        createAbortController: () => new AbortController()
      })
    },
    {
      provide: GatewayTrustChainHandler,
      inject: [MultiProfileUpstreamTokenVerifier, CanonicalIdentityResolver, GatewayBackendClient],
      useFactory: (
        upstreamTokenVerifier: MultiProfileUpstreamTokenVerifier,
        canonicalIdentityResolver: CanonicalIdentityResolver,
        gatewayBackendClient: GatewayBackendClient
      ) => new GatewayTrustChainHandler({ upstreamTokenVerifier, canonicalIdentityResolver, gatewayBackendClient })
    }
  ],
  exports: [GatewayTrustChainHandler]
})
export class GatewayModule {}
