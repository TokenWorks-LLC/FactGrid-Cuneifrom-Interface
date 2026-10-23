"use client";

import { useId, useState, type Ref, type UIEvent } from "react";

import { suggestedUnicodeFont, UNICODE_FONT_LABELS, type UnicodeFont } from "@/lib/unicode-font";

type FontSelection = "automatic" | UnicodeFont;

export function UnicodeText({
  text,
  periodLabels,
  fontLabel,
  className,
  ariaLabel,
  preRef,
  onScroll,
}: {
  text: string;
  periodLabels: string[];
  fontLabel: string;
  className: string;
  ariaLabel?: string;
  preRef?: Ref<HTMLPreElement>;
  onScroll?: (event: UIEvent<HTMLPreElement>) => void;
}) {
  const id = useId();
  const suggested = suggestedUnicodeFont(periodLabels);
  const [selection, setSelection] = useState<FontSelection>("automatic");
  const font = selection === "automatic" ? suggested : selection;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="text-sm font-medium" htmlFor={id}>Cuneiform font</label>
        <select
          aria-label={fontLabel}
          className="min-h-11 max-w-full border border-input bg-background px-3 text-sm"
          id={id}
          onChange={(event) => setSelection(event.target.value as FontSelection)}
          value={selection}
        >
          <option value="automatic">Automatic ({UNICODE_FONT_LABELS[suggested]})</option>
          <option value="noto">{UNICODE_FONT_LABELS.noto} (general)</option>
          <option value="old-babylonian">{UNICODE_FONT_LABELS["old-babylonian"]} (Old Babylonian)</option>
          <option value="neo-assyrian">{UNICODE_FONT_LABELS["neo-assyrian"]} (Neo-Assyrian)</option>
        </select>
      </div>
      <pre
        aria-label={ariaLabel}
        className={`transcript-text unicode-font-text ${className}`}
        data-unicode-font={font}
        onScroll={onScroll}
        ref={preRef}
        tabIndex={onScroll ? 0 : undefined}
      >
        {text || "The recognized transcript region is empty."}
      </pre>
    </div>
  );
}
