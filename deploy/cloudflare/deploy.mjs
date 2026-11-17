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
  // Wrangler activates the Worker before provisioning the container. Check
  // entitlement first so a missing paid plan cannot replace a working version
  // with a Worker whose container is unavailable.
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) throw new Error('Missing CLOUDFLARE_API_TOKEN for Containers preflight');
  const accountId = 'e090d615d06b656253822b7e79ea6b6c';
  const preflight = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/containers/me`, {
    headers: { authorization: `Bearer ${apiToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const result = await preflight.json().catch(() => null);
  if (!preflight.ok || result?.success !== true) {
    throw new Error(`Containers preflight failed (HTTP ${preflight.status}). Check Workers Paid activation and build token Containers permissions. No deployment was started.`);
  }
  console.log('Containers access preflight passed.');
  const directory = mkdtempSync(join(tmpdir(), 'sub2api-deploy-'));
  const path = join(directory, 'runtime-secrets.json');
  try {
    writeFileSync(path, JSON.stringify(secrets), { mode: 0o600 });
    const childEnv = { ...process.env };
    delete childEnv.SUB2API_RUNTIME_SECRETS;
    const result = spawnSync('npx', [
      '--yes', 'wrangler@4.163.0', 'deploy', '--config', 'wrangler.containers.jsonc',
      '--secrets-file', path,
      ...(process.argv.includes('--worker-only') ? ['--containers-rollout=none'] : []),
    ], { stdio: 'inherit', env: childEnv, shell: false });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
