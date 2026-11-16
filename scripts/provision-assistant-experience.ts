import 'dotenv/config';
import { runProvisionAssistantExperience } from '../src/assistant-experience/provision-assistant-experience.cli';

// Development entry point; production runs the compiled CLI inside the Core container.
runProvisionAssistantExperience(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'ASSISTANT_EXPERIENCE_PROVISION_FAILED'}\n`);
    process.exitCode = 1;
  });
