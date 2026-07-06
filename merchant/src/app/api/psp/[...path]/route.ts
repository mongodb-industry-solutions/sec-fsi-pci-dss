// Authenticated PSP proxy with a strict ALLOWLIST (C-11, CV-02).
// The browser calls /api/psp/<allowed> and the server attaches the Bearer.
// Out-of-scope PSP endpoints are never reachable through here.
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { ENV } from '@/lib/env';

// Allowlisted PSP paths (regex over the joined [...path]). Only least-privilege reads/writes.
const ALLOW: { method: string; pattern: RegExp }[] = [
  { method: 'GET', pattern: /^api\/v1\/auth\/userinfo$/ },
  { method: 'GET', pattern: /^api\/v1\/merchant\/beneficiaries\/[^/]+$/ },
  { method: 'GET', pattern: /^api\/v1\/accounts\/[^/]+$/ },
  { method: 'GET', pattern: /^api\/v1\/accounts\/[^/]+\/transfers$/ },
  { method: 'POST', pattern: /^api\/v1\/gateway\/transfers\/preview$/ },
];

function isAllowed(method: string, joined: string): boolean {
  return ALLOW.some((a) => a.method === method && a.pattern.test(joined));
}

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.join('/');

  if (!isAllowed(req.method, joined)) {
    return NextResponse.json({ error: 'forbidden_path' }, { status: 403 });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  // Thin authenticated forward: attach the server-held Bearer to an allowlisted PSP path.
  const url = new URL(`${ENV.pspBaseUrl()}/${joined}`);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method: req.method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(req.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: req.method !== 'GET' ? await req.text() : undefined,
    cache: 'no-store',
  }).catch(() => null);

  if (!res) return NextResponse.json({ error: 'psp_unreachable' }, { status: 502 });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
  });
}

export const GET = forward;
export const POST = forward;
