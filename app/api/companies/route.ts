import { NextResponse } from 'next/server';
import { getCompanies } from '@/lib/data-generator';
import { COMPANY_COUNT } from '@/lib/fortune500-data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/companies
 * Returns the pre-computed galaxy dataset (deterministic: the same galaxy
 * on every request).
 */
export async function GET() {
  const companies = getCompanies(COMPANY_COUNT);
  return NextResponse.json(companies);
}
