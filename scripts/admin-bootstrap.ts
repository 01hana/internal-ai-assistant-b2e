import 'dotenv/config';
import { runAdminBootstrap } from '../src/admin/bootstrap/admin-bootstrap.cli';

// Development entry point; deployments run the compiled CLI inside the Core image (deploy.sh admin-bootstrap).
runAdminBootstrap(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'ADMIN_BOOTSTRAP_FAILED'}\n`);
    process.exitCode = 1;
  });
