import { NextResponse } from 'next/server';

/**
 * Liveness for the container platform.
 *
 * Deliberately makes **no API call**. Using a real page as the startup probe
 * couples the storefront's ability to *start* to the API being reachable — so
 * an API blip would stop the web service booting, turning one outage into two.
 * A page may fail; the process is still alive and should stay up.
 *
 * Named `/status`, not `/healthz`. On Cloud Run the two paths behaved
 * differently: the container served `/healthz` (its startup probe, which hits
 * the container directly, passed) while external requests to it returned a
 * *Google-generated* 404 rather than anything this app produced. The cause was
 * not established. `/status` works on both paths, and a health endpoint that
 * cannot be reached externally is half a health check — uptime monitoring
 * needs it too.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok', service: 'freshkirana-web' });
}
