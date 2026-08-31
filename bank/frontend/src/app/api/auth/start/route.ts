import { NextResponse } from 'next/server';
import { startSignIn } from '../../../../lib/authority';

// Sends the browser to the authority's sign-in page. No credential is collected here.
export async function GET() {
  return NextResponse.redirect(await startSignIn());
}
