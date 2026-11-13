import { TABLET_ELIGIBILITY_POLICY } from "@/lib/factgrid/eligibility";
import { loadCatalogueIndex } from "@/lib/factgrid/catalogue-index.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public release identifiers and discovery freshness; no provider calls or configuration values. */
export async function GET() {
  const index = await loadCatalogueIndex();
  const revision = process.env.FACTGRID_BUILD_REVISION ?? "unknown";
  return Response.json({
    revision: /^[a-f0-9]{40}$/u.test(revision) ? revision : null,
    eligibilityPolicy: TABLET_ELIGIBILITY_POLICY,
    catalogue: index
      ? { complete: true, generatedAt: index.generatedAt, sourceCount: index.sourceCount }
      : { complete: false },
  }, { headers: { "Cache-Control": "no-store" } });
}
