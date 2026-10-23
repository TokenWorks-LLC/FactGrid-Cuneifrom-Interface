import { NextRequest, NextResponse } from "next/server";

import { isFactGridError } from "@/lib/factgrid/errors";
import { searchFacetEntities } from "@/lib/factgrid/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const results = await searchFacetEntities(request.nextUrl.searchParams.get("q") ?? "");
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const invalid = isFactGridError(error) && error.code === "INVALID_INPUT";
    return NextResponse.json(
      { error: invalid ? "Enter 2–100 characters." : "FactGrid search is unavailable. Try again." },
      { status: invalid ? 400 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
