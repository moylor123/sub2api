import test from 'node:test';
import assert from 'node:assert/strict';
import { containerEnvironment, requestForContainer } from './runtime.mjs';

function validEnvironment() {
  return {
    DATABASE_HOST: 'example.neon.tech', DATABASE_USER: 'app', DATABASE_PASSWORD: 'db-test-secret', DATABASE_DBNAME: 'app',
    REDIS_HOST: 'example.upstash.io', REDIS_PASSWORD: 'redis-test-secret',
    ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'test-password-long-enough',
    JWT_SECRET: 'a'.repeat(64), TOTP_ENCRYPTION_KEY: 'b'.repeat(64),
  };
}

test('incomplete secrets cannot start a public setup wizard', () => {
  const env = validEnvironment();
  delete env.DATABASE_PASSWORD;
  assert.throws(() => containerEnvironment(env), /DATABASE_PASSWORD/);
});

test('persistent secrets survive restarts and build credentials stay outside container', () => {
  const env = { ...validEnvironment(), CLOUDFLARE_API_TOKEN: 'must-not-leak' };
  const config = containerEnvironment(env);
  assert.equal(config.JWT_SECRET, env.JWT_SECRET);
  assert.equal(config.TOTP_ENCRYPTION_KEY, env.TOTP_ENCRYPTION_KEY);
  assert.equal(config.AUTO_SETUP, 'true');
  assert.equal(config.SETUP_MIGRATION_TIMEOUT_SECONDS, '600');
  assert.equal(config.DATABASE_SSLMODE, 'verify-full');
  assert.equal(config.REDIS_ENABLE_TLS, 'true');
  assert.equal(config.CLOUDFLARE_API_TOKEN, undefined);
});

test('managed database TLS cannot be disabled accidentally', () => {
  assert.throws(() => containerEnvironment({ ...validEnvironment(), DATABASE_SSLMODE: 'disable' }), /certificate/);
  assert.throws(() => containerEnvironment({ ...validEnvironment(), REDIS_ENABLE_TLS: 'false' }), /TLS/);
});

test('request proxy preserves method, credentials, query and body, replaces spoofed proxy headers', async () => {
  const input = new Request('https://api.codex666.net/v1/responses?stream=true', {
    method: 'POST', body: '{"model":"test","stream":true}',
    headers: { authorization: 'Bearer test', 'content-type': 'application/json',
      'cf-connecting-ip': '192.0.2.10', 'x-forwarded-for': 'spoofed', 'x-real-ip': 'spoofed', forwarded: 'spoofed' },
  });
  const forwarded = requestForContainer(input);
  assert.equal(forwarded.url, 'http://container/v1/responses?stream=true');
  assert.equal(forwarded.method, 'POST');
  assert.equal(forwarded.headers.get('authorization'), 'Bearer test');
  assert.equal(forwarded.headers.get('x-forwarded-for'), '192.0.2.10');
  assert.equal(forwarded.headers.get('forwarded'), null);
  assert.equal(forwarded.headers.get('x-real-ip'), null);
  assert.equal(forwarded.headers.get('x-forwarded-proto'), 'https');
  assert.equal(await forwarded.text(), '{"model":"test","stream":true}');
});
