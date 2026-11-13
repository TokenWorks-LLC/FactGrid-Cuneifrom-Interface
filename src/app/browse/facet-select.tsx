"use client";

import { useEffect, useState } from "react";

import type { LabeledEntity } from "@/lib/factgrid";

function selectOptions(options: LabeledEntity[]) {
  return options.map((option) => (
    <option key={option.id} value={option.id}>
      {option.label} ({option.id})
    </option>
  ));
}

export function FacetSelect({
  label,
  searchLabel,
  name,
  options,
  value,
}: {
  label: string;
  searchLabel: string;
  name: string;
  options: LabeledEntity[];
  value: string;
}) {
  const [selected, setSelected] = useState(value);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<LabeledEntity[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [catalogueMatches, setCatalogueMatches] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedOption, setSelectedOption] = useState<LabeledEntity | undefined>(
    options.find((option) => option.id === value),
  );
  const [status, setStatus] = useState("");

  useEffect(() => {
    const term = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ property: name, q: term, offset: String(offset) });
        const response = await fetch(`/api/facets?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Facet lookup failed");
        const data = (await response.json()) as {
          results: LabeledEntity[]; complete: boolean; total?: number; nextOffset: number | null;
        };
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.results) || data.results.length > 50) throw new Error("Invalid facet response");
        setMatches(data.results);
        setSelectedOption((previous) => data.results.find((option) => option.id === previous?.id) ?? previous);
        setCatalogueMatches(data.complete);
        setNextOffset(data.nextOffset);
        setStatus(data.complete
          ? data.results.length
            ? `Catalogue values ${offset + 1}–${offset + data.results.length} of ${data.total ?? data.results.length}.`
            : "No matching catalogue values."
          : term.length >= 2
            ? `${data.results.length} general FactGrid name matches. Catalogue-wide discovery is unavailable.`
            : "Search names to find more values. Catalogue-wide discovery is unavailable.");
      } catch {
        if (!controller.signal.aborted) setStatus("FactGrid search is unavailable. Try again.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, offset, name]);

  const choices = new Map<string, LabeledEntity>(
    (catalogueMatches || query.trim().length >= 2 ? [] : options.slice(0, 50)).map((option) => [option.id, option]),
  );
  for (const match of matches) choices.set(match.id, match);
  if (selectedOption && !choices.has(selected)) choices.set(selected, selectedOption);

  return (
    <div>
      <label className="text-sm font-medium" htmlFor={`facet-${name}`}>
        {label}
      </label>
      <select
        aria-describedby={`facet-status-${name}`}
        className="mt-2 min-h-11 w-full border border-input bg-background px-3 text-sm"
        id={`facet-${name}`}
        name={name}
        onChange={(event) => {
          setSelected(event.target.value);
          setSelectedOption(choices.get(event.target.value));
        }}
        value={selected}
      >
        <option value="">Any</option>
        {selectOptions([...choices.values()])}
      </select>
      <label className="mt-2 block text-xs text-muted-foreground" htmlFor={`facet-search-${name}`}>
        {searchLabel}
      </label>
      <input
        className="mt-1 min-h-10 w-full border border-input bg-background px-3 text-sm"
        id={`facet-search-${name}`}
        maxLength={100}
        onChange={(event) => {
          setQuery(event.target.value);
          setOffset(0);
          setNextOffset(null);
          setMatches([]);
          setStatus("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        placeholder="Search by label or QID"
        type="search"
        value={query}
      />
      <p aria-live="polite" className="mt-1 text-xs text-muted-foreground" id={`facet-status-${name}`}>
        {loading ? "Finding values…" : status}
      </p>
      {offset > 0 || nextOffset !== null ? (
        <div className="mt-2 flex flex-wrap gap-3">
          {offset > 0 ? (
            <button className="focus-ring min-h-10 text-xs underline" disabled={loading} onClick={() => setOffset(Math.max(0, offset - 50))} type="button">
              Previous {label.toLowerCase()} values
            </button>
          ) : null}
          {nextOffset !== null ? (
            <button className="focus-ring min-h-10 text-xs underline" disabled={loading} onClick={() => setOffset(nextOffset)} type="button">
              More {label.toLowerCase()} values
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
