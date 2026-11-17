import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { containerEnvironment, requiredSecrets } from './runtime.mjs';

// Workers Builds stores this as one encrypted build secret. Copy only the
// application secrets into a temporary JSON file outside the Docker context;
// never print the values or pass them as command-line arguments.
const source = process.env.SUB2API_RUNTIME_SECRETS;
if (!source) throw new Error('Missing encrypted SUB2API_RUNTIME_SECRETS build variable');
const parsed = JSON.parse(source);
containerEnvironment(parsed);
const secrets = Object.fromEntries(requiredSecrets.map((name) => [name, parsed[name]]));
if (process.argv.includes('--check-only')) {
  console.log(`Validated ${requiredSecrets.length} required runtime secrets; values are not displayed.`);
} else {
  const directory = mkdtempSync(join(tmpdir(), 'sub2api-deploy-'));
  const path = join(directory, 'runtime-secrets.json');
  try {
    writeFileSync(path, JSON.stringify(secrets), { mode: 0o600 });
    const childEnv = { ...process.env };
    delete childEnv.SUB2API_RUNTIME_SECRETS;
    const result = spawnSync('npx', [
      '--yes', 'wrangler@4.163.0', 'deploy', '--config', 'wrangler.containers.jsonc',
      '--secrets-file', path,
    ], { stdio: 'inherit', env: childEnv, shell: false });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
