// Retain the provisioned namespace while serving the compiled frontend during
// a container provisioning outage. API routes must never receive SPA HTML.
export { Sub2APIContainer } from './worker.mjs';

export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health' || /^\/(api|v1|setup)(\/|$)/.test(path)) {
      return Response.json({ error: { message: 'Backend deployment pending', type: 'service_unavailable' } },
        { status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
    }
    return env.ASSETS.fetch(request);
  },
};
