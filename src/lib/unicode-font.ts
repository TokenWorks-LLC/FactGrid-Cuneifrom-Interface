export type UnicodeFont = "noto" | "old-babylonian" | "neo-assyrian";

export const UNICODE_FONT_LABELS: Record<UnicodeFont, string> = {
  noto: "Noto Sans Cuneiform",
  "old-babylonian": "Cuneiform OB",
  "neo-assyrian": "Cuneiform NA",
};

/** Only select a period style when the metadata names one unambiguous match. */
export function suggestedUnicodeFont(periodLabels: string[]): UnicodeFont {
  const labels = periodLabels.join(" ");
  const oldBabylonian = /\bold[\s-]+babylonian\b/iu.test(labels);
  const neoAssyrian = /\bneo[\s-]+assyrian\b/iu.test(labels);

  if (oldBabylonian === neoAssyrian) return "noto";
  return oldBabylonian ? "old-babylonian" : "neo-assyrian";
}
