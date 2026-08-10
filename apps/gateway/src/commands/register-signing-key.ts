import { KeyLifecycleService, type RegisterSigningKeyInput } from '../signing/key-lifecycle.service';

/** Internal/direct-only command. It intentionally has no HTTP controller. */
export class RegisterSigningKeyCommand {
  constructor(private readonly lifecycle: KeyLifecycleService) {}

  execute(input: RegisterSigningKeyInput) {
    return this.lifecycle.register(input);
  }
}
