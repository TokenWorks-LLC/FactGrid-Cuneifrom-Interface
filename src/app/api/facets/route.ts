import { NextRequest, NextResponse } from "next/server";

import { isFactGridError } from "@/lib/factgrid/errors";
import { searchFacetEntities } from "@/lib/factgrid/server";
import { searchCatalogueFacets, type CatalogueFacet } from "@/lib/factgrid/catalogue-index";
import { loadCatalogueIndex } from "@/lib/factgrid/catalogue-index.server";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const property = request.nextUrl.searchParams.get("property") ?? "collection";
    const offset = Number(request.nextUrl.searchParams.get("offset") || 0);
    if (!["collection", "findspot", "period", "language", "workType", "material"].includes(property) ||
        query.length > 100 || /[\u0000-\u001f\u007f]/u.test(query) ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
      return NextResponse.json({ error: "Invalid facet search." }, { status: 400 });
    }
    const index = await loadCatalogueIndex();
    if (index) {
      const matches = searchCatalogueFacets(index, property as CatalogueFacet, query);
      const results = matches.slice(offset, offset + 50);
      return NextResponse.json({ results, total: matches.length, nextOffset: offset + 50 < matches.length ? offset + 50 : null,
        complete: true, generatedAt: index.generatedAt }, { headers: { "Cache-Control": "no-store" } });
    }
    const results = query.length >= 2 ? await searchFacetEntities(query) : [];
    return NextResponse.json({ results, complete: false, nextOffset: null,
      notice: "Catalogue index is not configured. These are general FactGrid name matches; catalogue completeness is unavailable." },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const invalid = isFactGridError(error) && error.code === "INVALID_INPUT";
    return NextResponse.json(
      { error: invalid ? "Enter 2–100 characters." : "FactGrid search is unavailable. Try again." },
      { status: invalid ? 400 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
