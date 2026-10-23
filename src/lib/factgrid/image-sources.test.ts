import { describe, expect, it } from "vitest";

import { isDirectImageUrl, isManifestUrl, pageFromImageUrl, pagesFromManifest } from "./image-sources";

describe("image source adaptation", () => {
  it("recognizes named and extensionless manifest candidates", () => {
    expect(isManifestUrl("https://example.org/manifest/")).toBe(true);
    expect(isManifestUrl("https://example.org/canvas.json")).toBe(true);
    expect(isManifestUrl("https://example.org/iiif/3/Q123")).toBe(false);
    expect(isDirectImageUrl("https://example.org/iiif/3/Q123")).toBe(false);
    expect(isDirectImageUrl("https://example.org/iiif/3/Q123/info.json")).toBe(true);
  });
  it("uses a IIIF image service for a full-size image URL", () => {
    expect(pageFromImageUrl("https://example.org/iiif/2/item/full/full/0/default.png")).toEqual({
      label: "Image",
      tileSource: "https://example.org/iiif/2/item/info.json",
      fallbackUrl: "https://example.org/iiif/2/item/full/full/0/default.png",
    });
  });

  it("reads painting images from a Presentation 3 manifest and rejects unsafe URLs", () => {
    const manifest = {
      type: "Manifest",
      items: [
        { label: { en: ["Front"] }, items: [{ items: [{ motivation: "painting", body: { id: "https://example.org/front/full/full/0/default.jpg", service: [{ id: "https://example.org/front" }] } }] }] },
        { label: { en: ["Bad"] }, items: [{ items: [{ motivation: "painting", body: { id: "javascript:alert(1)" } }] }] },
      ],
    };
    expect(pagesFromManifest(manifest)).toEqual([{ label: "Front", tileSource: "https://example.org/front/info.json", fallbackUrl: "https://example.org/front/full/full/0/default.jpg" }]);
  });

  it("reads a Presentation 2 canvas image", () => {
    expect(pagesFromManifest({ sequences: [{ canvases: [{ label: "Reverse", images: [{ resource: { "@id": "https://example.org/back.jpg" } }] }] }] })).toEqual([
      { label: "Reverse", tileSource: { type: "image", url: "https://example.org/back.jpg", buildPyramid: false } },
    ]);
  });
});
