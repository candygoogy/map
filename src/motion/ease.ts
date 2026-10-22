// The easing helpers shared by everything that moves in code (the camera, the sheet, links,
// nodes, the visitor), so each curve is written once.

export const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
/** 0 at a, 1 at b, smooth at both ends. */
export const smoothstep = (a: number, b: number, x: number): number => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
export const easeInOutCubic = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
export const easeOutCubic = (x: number): number => 1 - (1 - x) ** 3;
