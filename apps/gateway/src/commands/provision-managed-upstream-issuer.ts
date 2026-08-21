import { ManagedExchangeActivationValidator } from '../managed-identity-exchange/persistence/managed-exchange-activation.validator';
import { GatewaySigningAuthorityReader } from '../managed-identity-exchange/persistence/gateway-signing-authority.reader';
import { VersionedManagedExchangeProvisionCommand } from './managed-exchange-control-plane';
export class ProvisionManagedUpstreamIssuerCommand extends VersionedManagedExchangeProvisionCommand {
  constructor(dependencies: Omit<ConstructorParameters<typeof VersionedManagedExchangeProvisionCommand>[0], 'kind' | 'validator'> & Readonly<{ gatewaySigningAuthority: GatewaySigningAuthorityReader; activationValidator?: ManagedExchangeActivationValidator }>) {
    const validator = dependencies.activationValidator ?? new ManagedExchangeActivationValidator();
    super({ ...dependencies, kind: 'issuer', validator: (input) => { validator.validateIssuer(input); dependencies.gatewaySigningAuthority.assertDistinctIssuer(input.issuer); } });
  }
}
