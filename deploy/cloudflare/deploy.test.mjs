import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const fixture = {
  DATABASE_HOST: 'example.neon.tech', DATABASE_USER: 'test', DATABASE_PASSWORD: 'test', DATABASE_DBNAME: 'test',
  REDIS_HOST: 'example.upstash.io', REDIS_PASSWORD: 'test', ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'long-test-only-password', JWT_SECRET: 'a'.repeat(64), TOTP_ENCRYPTION_KEY: 'b'.repeat(64),
};
const deployUrl = new URL('./deploy.mjs', import.meta.url).href;

function simulate(allowed) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    import {readFileSync,existsSync} from 'node:fs';
    let called = false;
    let secretsPath;
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).origin, 'https://api.cloudflare.com');
      assert.equal(options.headers.authorization, 'Bearer fake-build-token');
      return {ok:${allowed}, status:${allowed ? 200 : 403}, json:async()=>({success:${allowed}})};
    };
    childProcess.spawnSync = (command,args,options) => {
      called = true;
      assert.equal(command, 'npx');
      assert.equal(options.env.SUB2API_RUNTIME_SECRETS, undefined);
      secretsPath = args[args.indexOf('--secrets-file')+1];
      const uploaded = JSON.parse(readFileSync(secretsPath,'utf8'));
      assert.equal(uploaded.JWT_SECRET, 'a'.repeat(64));
      assert.equal(uploaded.CLOUDFLARE_API_TOKEN, undefined);
      return {status:0};
    };
    syncBuiltinESMExports();
    try {
      await import(${JSON.stringify(deployUrl)});
      assert.equal(${allowed}, true);
      assert.equal(called, true);
      assert.equal(existsSync(secretsPath), false);
    } catch(error) {
      if (${allowed}) throw error;
      assert.match(error.message, /Containers preflight failed/);
      assert.equal(called, false);
    }
  `], {encoding:'utf8', env:{...process.env,CLOUDFLARE_API_TOKEN:'fake-build-token',SUB2API_RUNTIME_SECRETS:JSON.stringify(fixture)}});
}

test('unavailable Containers prevents publishing a Worker', () => {
  const result = simulate(false);
  assert.equal(result.status, 0, result.stderr);
});

test('allowed deployment isolates and removes temporary runtime secrets', () => {
  const result = simulate(true);
  assert.equal(result.status, 0, result.stderr);
});
