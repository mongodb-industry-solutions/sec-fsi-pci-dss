// Liveness/readiness endpoint. The kanopy `mongodb/web-app` chart probes GET /health; without a
// 200 here the merchant pod never becomes ready and the service mesh reports "no healthy upstream".
// Self-contained: the merchant has NO database, so a 200 simply means the Next.js server is serving.
// CORS-open so the PSP admin monitoring page (a different origin) can read the status cross-origin.
import { NextResponse } from 'next/server';

// Never prerendered/cached — always reflect the live server state.
export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

export function GET() {
  return NextResponse.json({ status: 'ok', service: 'sec-fsi-pci-dss-merchant' }, { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,OPTIONS' } });
}
