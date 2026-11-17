import { DurableObject } from 'cloudflare:workers';
import { containerEnvironment, requestForContainer } from './runtime.mjs';

// One application instance; PostgreSQL and Redis remain outside ephemeral disk.
// Idle shutdown also suspends background work. Increase this only after agreeing
// an operating budget if scheduled background jobs must run continuously.
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;

export class Sub2APIContainer extends DurableObject {
  starting;

  constructor(ctx, env) {
    super(ctx, env);
    if (ctx.container?.running) {
      ctx.blockConcurrencyWhile(() => ctx.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
    }
  }

  async ensureReady() {
    const container = this.ctx.container;
    if (!container.running) {
      container.start({ enableInternet: true, env: containerEnvironment(this.env) });
    }
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(8080);
    // The first boot can run database migrations. Share this bounded wait among
    // concurrent incoming requests rather than start multiple instances.
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      try {
        const response = await port.fetch('http://container/health', { signal: AbortSignal.timeout(2000) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // Socket not ready yet. Do not log secrets or upstream connection strings.
      }
      await scheduler.wait(1000);
    }
    throw new Error('Sub2API startup did not become healthy within 180 seconds');
  }

  async fetch(request) {
    try {
      this.starting ??= this.ensureReady().finally(() => { this.starting = undefined; });
      await this.starting;
    } catch {
      console.error('Sub2API startup failed; inspect container logs and required runtime secrets');
      return Response.json({ error: { message: 'Service is starting or unavailable', type: 'service_unavailable' } },
        { status: 503, headers: { 'Retry-After': '10', 'Cache-Control': 'no-store' } });
    }
    // Forward once. Retrying POST requests could duplicate charges or mutations.
    // Return the streamed body directly without buffering SSE or model output.
    return this.ctx.container.getTcpPort(8080).fetch(requestForContainer(request));
  }
}

export default {
  fetch(request, env) {
    return env.SUB2API.getByName('api-production').fetch(request);
  },
};
