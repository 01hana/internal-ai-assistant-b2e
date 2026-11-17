import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { AppConfigModule } from '../common/config/app-config.module';
import { AssistantExperienceModule } from './assistant-experience.module';
import { AssistantExperienceRepository } from './assistant-experience.repository';
import { AssistantExperienceValidator } from './assistant-experience.validator';
import { ProvisionAssistantExperienceCommand, ProvisionAssistantExperienceError } from './provision-assistant-experience.command';

/**
 * Usage (compiled into the Core image so it can run inside the deployment):
 *   node dist/src/assistant-experience/provision-assistant-experience.cli.js --file <path> [--check] [--allow-unverified]
 * Validates against the Capability Packs configured by ASSISTANT_CAPABILITY_PACK_PATHS_JSON.
 */
export interface ProvisionCliArguments {
  readonly file: string;
  readonly checkOnly: boolean;
  readonly allowUnverified: boolean;
}

export function parseProvisionCliArguments(argv: readonly string[]): ProvisionCliArguments {
  let file: string | undefined;
  let checkOnly = false;
  let allowUnverified = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--file' && argv[index + 1] && !argv[index + 1].startsWith('--') && file === undefined) file = argv[++index];
    else if (flag === '--check' && !checkOnly) checkOnly = true;
    else if (flag === '--allow-unverified' && !allowUnverified) allowUnverified = true;
    else throw new Error('Usage: --file <path> [--check] [--allow-unverified]');
  }
  if (!file) throw new Error('Usage: --file <path> [--check] [--allow-unverified]');
  return { file, checkOnly, allowUnverified };
}

@Module({ imports: [AppConfigModule, AssistantExperienceModule] })
class AssistantExperienceProvisioningModule {}

export async function runProvisionAssistantExperience(argv: readonly string[]): Promise<number> {
  const args = parseProvisionCliArguments(argv);
  const input: unknown = JSON.parse(readFileSync(args.file, 'utf8'));
  const app = await NestFactory.createApplicationContext(AssistantExperienceProvisioningModule, { logger: ['error', 'warn'] });
  try {
    const command = new ProvisionAssistantExperienceCommand(app.get(AssistantExperienceRepository), app.get(AssistantExperienceValidator));
    const result = await command.execute(input, args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof ProvisionAssistantExperienceError)) throw error;
    process.stderr.write(`${JSON.stringify({ code: error.code, errors: error.errors })}\n`);
    return 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  runProvisionAssistantExperience(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'ASSISTANT_EXPERIENCE_PROVISION_FAILED'}\n`);
      process.exitCode = 1;
    });
}
