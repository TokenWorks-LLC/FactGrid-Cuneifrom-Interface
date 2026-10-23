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
  const [selectedOption, setSelectedOption] = useState<LabeledEntity | undefined>(
    options.find((option) => option.id === value),
  );
  const [status, setStatus] = useState("");

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/facets?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Facet lookup failed");
        const data = (await response.json()) as { results: LabeledEntity[] };
        setMatches(data.results);
        setStatus(data.results.length ? `${data.results.length} matches added to the dropdown above` : "No matching FactGrid entities");
      } catch {
        if (!controller.signal.aborted) setStatus("FactGrid search is unavailable. Try again.");
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const choices = new Map<string, LabeledEntity>(options.map((option) => [option.id, option]));
  for (const match of matches) choices.set(match.id, match);
  if (selectedOption) choices.set(selected, selectedOption);

  return (
    <div>
      <label className="text-sm font-medium" htmlFor={`facet-${name}`}>
        {label}
      </label>
      <select
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
          setMatches([]);
          setStatus("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        placeholder="Type at least 2 characters"
        type="search"
        value={query}
      />
      <p aria-live="polite" className="mt-1 text-xs text-muted-foreground">{status}</p>
    </div>
  );
}
