import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTablet: vi.fn(),
  hasCanonicalTranscription: vi.fn(),
  tabletEditor: vi.fn(() => null),
}));

vi.mock("@/lib/factgrid/server", () => ({
  getTablet: mocks.getTablet,
  hasCanonicalTranscription: mocks.hasCanonicalTranscription,
}));
vi.mock("@/lib/factgrid", () => ({ FactGridNotFoundError: class FactGridNotFoundError extends Error {} }));
vi.mock("@/components/tablet-editor", () => ({ TabletEditor: mocks.tabletEditor }));

import TabletEditorPage from "./page";

describe("tablet metadata editor page", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    { name: "no linked document", editions: [], canonicalExists: undefined, offerTranscriptionCreation: true },
    { name: "existing canonical document, including unsupported content", editions: [{ reference: { title: "D-Q42" } }], canonicalExists: true, offerTranscriptionCreation: false },
    { name: "linked but missing canonical document", editions: [{ reference: { title: "D-Q42" } }], canonicalExists: false, offerTranscriptionCreation: true },
    { name: "noncanonical document", editions: [{ reference: { title: "CDLI-W-Q42" } }], canonicalExists: undefined, offerTranscriptionCreation: false },
    { name: "missing canonical document alongside another edition", editions: [{ reference: { title: "D-Q42" } }, { reference: { title: "ORACC-W-Q42" } }], canonicalExists: false, offerTranscriptionCreation: true },
  ])("preserves creation eligibility for $name without reading revisions", async ({ editions, canonicalExists, offerTranscriptionCreation }) => {
    mocks.getTablet.mockResolvedValue({ qid: "Q42", title: "Tablet", editions });
    mocks.hasCanonicalTranscription.mockResolvedValue(canonicalExists);

    const element = await TabletEditorPage({ params: Promise.resolve({ qid: "Q42" }) });
    renderToStaticMarkup(element);

    expect(mocks.getTablet).toHaveBeenCalledWith("Q42", { includeDocuments: false });
    if (canonicalExists === undefined) expect(mocks.hasCanonicalTranscription).not.toHaveBeenCalled();
    else expect(mocks.hasCanonicalTranscription).toHaveBeenCalledExactlyOnceWith("Q42");
    expect(mocks.tabletEditor).toHaveBeenCalledWith(
      expect.objectContaining({ qid: "Q42", offerTranscriptionCreation }),
      undefined,
    );
  });

  it("does not treat a failed existence check as permission to create", async () => {
    mocks.getTablet.mockResolvedValue({ qid: "Q42", title: "Tablet", editions: [{ reference: { title: "D-Q42" } }] });
    mocks.hasCanonicalTranscription.mockRejectedValue(new Error("FactGrid unavailable"));

    await expect(TabletEditorPage({ params: Promise.resolve({ qid: "Q42" }) })).rejects.toThrow("FactGrid unavailable");
    expect(mocks.tabletEditor).not.toHaveBeenCalled();
  });
});
