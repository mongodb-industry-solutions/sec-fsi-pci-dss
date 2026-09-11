import { NextResponse } from 'next/server';
import { currentStaff } from '../../../../lib/authority';

// What the gate asks on load, so a reload does not send a signed-in person back to the form.
export async function GET() {
  const staff = await currentStaff();
  if (!staff) return NextResponse.json({ signedIn: false }, { status: 200 });
  return NextResponse.json({ signedIn: true, ...staff });
}
