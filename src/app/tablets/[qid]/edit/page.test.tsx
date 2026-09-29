import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTablet: vi.fn(),
  tabletEditor: vi.fn(() => null),
}));

vi.mock("@/lib/factgrid/server", () => ({ getTablet: mocks.getTablet }));
vi.mock("@/lib/factgrid", () => ({ FactGridNotFoundError: class FactGridNotFoundError extends Error {} }));
vi.mock("@/components/tablet-editor", () => ({ TabletEditor: mocks.tabletEditor }));

import TabletEditorPage from "./page";

describe("tablet metadata editor page", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { editions: [], offerTranscriptionCreation: true },
    { editions: [{ reference: { title: "D-Q42" } }], offerTranscriptionCreation: false },
  ])("avoids document revisions while preserving creation eligibility", async ({ editions, offerTranscriptionCreation }) => {
    mocks.getTablet.mockResolvedValue({ qid: "Q42", title: "Tablet", editions });

    const element = await TabletEditorPage({ params: Promise.resolve({ qid: "Q42" }) });
    renderToStaticMarkup(element);

    expect(mocks.getTablet).toHaveBeenCalledWith("Q42", { includeDocuments: false });
    expect(mocks.tabletEditor).toHaveBeenCalledWith(
      expect.objectContaining({ qid: "Q42", offerTranscriptionCreation }),
      undefined,
    );
  });
});
