import { NextRequest, NextResponse } from 'next/server';
import { callBankAdmin } from '../../../../lib/bankApi';

// The browser's only door to the bank, on this app's own origin.
//
// Reads and writes both go through here, so the token stays server side and the client never learns the
// bank's host. The allowlist lives in `bankApi`, next to the call it guards.

function resourceOf(path: string[] | undefined): string {
  return (path ?? []).map((segment) => decodeURIComponent(segment)).join('/');
}

function queryOf(request: NextRequest): Record<string, string> {
  const query: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((value, key) => { query[key] = value; });
  return query;
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path } = await context.params;
  const result = await callBankAdmin(resourceOf(path), { query: queryOf(request) });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body, { status: result.status });
}

async function write(request: NextRequest, path: string[] | undefined, method: string) {
  const body = await request.json().catch(() => undefined);
  const result = await callBankAdmin(resourceOf(path), { method, body: body ?? {} });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body, { status: result.status });
}

/**
 * Withdrawing something from use: a card revoked, an account closed.
 *
 * Neither is an erasure at the bank, and this handler exists so a screen can say "delete" while the bank does
 * the correct thing underneath. A card that authorised a payment and an account that received one are both
 * referred to by records that have to keep making sense.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path } = await context.params;
  const result = await callBankAdmin(resourceOf(path), { method: 'DELETE' });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body, { status: result.status });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path } = await context.params;
  return write(request, path, 'PUT');
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path } = await context.params;
  return write(request, path, 'PATCH');
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path } = await context.params;
  return write(request, path, 'POST');
}
