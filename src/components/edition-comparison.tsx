"use client";

import { useRef, useState, useSyncExternalStore, type RefObject, type UIEvent } from "react";

export interface ComparableEdition {
  id: string;
  label: string;
  sourceTitle: string;
  text: string;
}

const subscribeToHydration = () => () => undefined;
const getHydratedSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export function EditionComparison({ editions }: { editions: ComparableEdition[] }) {
  const [leftIndex, setLeftIndex] = useState(0);
  const [rightIndex, setRightIndex] = useState(1);
  const interactive = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerHydrationSnapshot,
  );
  const leftRef = useRef<HTMLPreElement>(null);
  const rightRef = useRef<HTMLPreElement>(null);
  const synchronizing = useRef(false);

  if (editions.length < 2) return null;

  function synchronize(
    event: UIEvent<HTMLPreElement>,
    target: RefObject<HTMLPreElement | null>,
  ) {
    if (synchronizing.current || !target.current) return;
    const source = event.currentTarget;
    const sourceRange = source.scrollHeight - source.clientHeight;
    const targetRange = target.current.scrollHeight - target.current.clientHeight;
    synchronizing.current = true;
    target.current.scrollTop = sourceRange > 0 ? (source.scrollTop / sourceRange) * targetRange : 0;
    requestAnimationFrame(() => {
      synchronizing.current = false;
    });
  }

  const left = editions[leftIndex] ?? editions[0];
  const right = editions[rightIndex] ?? editions[1];

  return (
    <section
      aria-busy={!interactive}
      aria-labelledby="comparison-title"
      className="border-b border-border py-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">
            Reading tool
          </p>
          <h3 id="comparison-title" className="mt-2 font-heading text-2xl font-medium">
            Compare two editions
          </h3>
        </div>
        <p className="max-w-[44ch] text-sm leading-6 text-muted-foreground">
          Scrolling one text keeps the other at the same relative position.
        </p>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <ComparisonPane
          edition={left}
          editions={editions}
          interactive={interactive}
          onChange={setLeftIndex}
          onScroll={(event) => synchronize(event, rightRef)}
          pane="left"
          paneRef={leftRef}
          value={leftIndex}
        />
        <ComparisonPane
          edition={right}
          editions={editions}
          interactive={interactive}
          onChange={setRightIndex}
          onScroll={(event) => synchronize(event, leftRef)}
          pane="right"
          paneRef={rightRef}
          value={rightIndex}
        />
      </div>
    </section>
  );
}

function ComparisonPane({
  edition,
  editions,
  interactive,
  onChange,
  onScroll,
  pane,
  paneRef,
  value,
}: {
  edition: ComparableEdition;
  editions: ComparableEdition[];
  interactive: boolean;
  onChange: (value: number) => void;
  onScroll: (event: UIEvent<HTMLPreElement>) => void;
  pane: "left" | "right";
  paneRef: RefObject<HTMLPreElement | null>;
  value: number;
}) {
  return (
    <div className="min-w-0">
      <label className="text-sm font-medium" htmlFor={`comparison-${pane}`}>
        Edition
      </label>
      <select
        className="mt-2 min-h-11 w-full border border-input bg-background px-3 text-sm"
        disabled={!interactive}
        id={`comparison-${pane}`}
        onChange={(event) => onChange(Number(event.target.value))}
        value={value}
      >
        {editions.map((option, index) => (
          <option key={option.id} value={index}>
            {option.label} · {option.sourceTitle}
          </option>
        ))}
      </select>
      <pre
        ref={paneRef}
        aria-label={`${edition.label}, ${edition.sourceTitle}`}
        className="transcript-text mt-3 h-[30rem] overflow-auto border border-border bg-card p-4 text-sm leading-6 whitespace-pre-wrap"
        onScroll={onScroll}
        tabIndex={0}
      >
        {edition.text || "The recognized transcript region is empty."}
      </pre>
    </div>
  );
}
