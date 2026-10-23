/** Distance that keeps a bounding sphere inside both axes of a perspective view. */
export function fitSphereDistance(radius: number, verticalFovDegrees: number, aspect: number): number {
  const verticalHalfFov = (verticalFovDegrees * Math.PI) / 360;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
  return (radius / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov))) * 1.1;
}
