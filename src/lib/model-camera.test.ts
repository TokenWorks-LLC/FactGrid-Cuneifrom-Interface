import { describe, expect, it } from "vitest";

import { fitSphereDistance } from "./model-camera";

describe("model camera fit", () => {
  it("keeps a bounding sphere inside both viewport axes on narrow and wide screens", () => {
    const radius = 5;
    const verticalHalfFov = (45 * Math.PI) / 360;

    for (const aspect of [288 / 352, 1, 16 / 9]) {
      const distance = fitSphereDistance(radius, 45, aspect);
      const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
      expect(distance * Math.sin(verticalHalfFov)).toBeGreaterThan(radius);
      expect(distance * Math.sin(horizontalHalfFov)).toBeGreaterThan(radius);
    }

    expect(fitSphereDistance(radius, 45, 288 / 352)).toBeGreaterThan(
      fitSphereDistance(radius, 45, 16 / 9),
    );
  });
});
