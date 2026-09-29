import { NextResponse } from 'next/server';
import { signOut } from '../../../../lib/authority';

export async function POST() {
  await signOut();
  return NextResponse.json({ signedOut: true });
}
