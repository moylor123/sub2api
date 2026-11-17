// Explicit allowlist: build credentials and unrelated Worker bindings must never
// become environment variables in the application container.
export const requiredSecrets = [
  'DATABASE_HOST', 'DATABASE_USER', 'DATABASE_PASSWORD', 'DATABASE_DBNAME',
  'REDIS_HOST', 'REDIS_PASSWORD', 'ADMIN_EMAIL', 'ADMIN_PASSWORD',
  'JWT_SECRET', 'TOTP_ENCRYPTION_KEY',
];

export function containerEnvironment(env) {
  const missing = requiredSecrets.filter((key) => typeof env[key] !== 'string' || !env[key].trim());
  if (missing.length) throw new Error(`Missing runtime secrets: ${missing.join(', ')}`);
  if (!/^[a-f\d]{64}$/i.test(env.JWT_SECRET) || !/^[a-f\d]{64}$/i.test(env.TOTP_ENCRYPTION_KEY)) {
    throw new Error('JWT_SECRET and TOTP_ENCRYPTION_KEY must each be 32-byte hexadecimal secrets');
  }
  if (env.ADMIN_PASSWORD.length < 16) throw new Error('ADMIN_PASSWORD must contain at least 16 characters');
  if (!['verify-full', 'verify-ca'].includes(env.DATABASE_SSLMODE ?? 'verify-full')) {
    throw new Error('Remote PostgreSQL requires certificate verification');
  }
  if ((env.REDIS_ENABLE_TLS ?? 'true') !== 'true') throw new Error('Remote Redis requires TLS');

  return {
    AUTO_SETUP: 'true', SERVER_HOST: '0.0.0.0', SERVER_PORT: '8080',
    // Remote PostgreSQL needs more than the upstream 60-second migration limit.
    SETUP_MIGRATION_TIMEOUT_SECONDS: '600',
    SERVER_MODE: 'release', RUN_MODE: 'standard', TZ: 'Asia/Shanghai',
    // Connections are deliberately bounded for small managed database plans.
    DATABASE_MAX_OPEN_CONNS: '10', DATABASE_MAX_IDLE_CONNS: '2',
    DATABASE_CONN_MAX_LIFETIME_MINUTES: '10', DATABASE_CONN_MAX_IDLE_TIME_MINUTES: '2',
    REDIS_POOL_SIZE: '10', REDIS_MIN_IDLE_CONNS: '1',
    DATABASE_PORT: env.DATABASE_PORT ?? '5432', DATABASE_SSLMODE: env.DATABASE_SSLMODE ?? 'verify-full',
    REDIS_PORT: env.REDIS_PORT ?? '6379', REDIS_USERNAME: env.REDIS_USERNAME ?? 'default',
    REDIS_ENABLE_TLS: 'true', REDIS_DB: env.REDIS_DB ?? '0',
    MCP_PUBLIC_URL: env.PUBLIC_ORIGIN ?? 'https://api.codex666.net',
    ...Object.fromEntries(requiredSecrets.map((key) => [key, env[key]])),
  };
}

export function requestForContainer(request) {
  const publicUrl = new URL(request.url);
  const internalUrl = new URL(request.url);
  internalUrl.protocol = 'http:';
  internalUrl.host = 'container';
  const forwarded = new Request(internalUrl, request);
  forwarded.headers.delete('host');
  forwarded.headers.delete('forwarded');
  forwarded.headers.delete('x-real-ip');
  forwarded.headers.delete('x-forwarded-for');
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) forwarded.headers.set('x-forwarded-for', clientIp);
  forwarded.headers.set('x-forwarded-host', publicUrl.host);
  forwarded.headers.set('x-forwarded-proto', publicUrl.protocol.slice(0, -1));
  return forwarded;
}
