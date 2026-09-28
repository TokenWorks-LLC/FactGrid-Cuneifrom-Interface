"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { TransliterationEditor } from "@/components/transliteration-editor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface PreviewEdition {
  id: string;
  label: string;
  text: string;
  historyUrl: string;
  description: string;
}

interface MetadataDraft {
  title: string;
  description: string;
  inventoryNumbers: string;
}

const subscribeToHydration = () => () => undefined;
const getHydratedSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export function TabletEditorPreview({
  initialMetadata,
  editions,
}: {
  initialMetadata: MetadataDraft;
  editions: PreviewEdition[];
}) {
  const [metadata, setMetadata] = useState(initialMetadata);
  const [editionIndex, setEditionIndex] = useState(0);
  const interactive = useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerHydrationSnapshot);
  const metadataDirty = Object.keys(initialMetadata).some(
    (field) => metadata[field as keyof MetadataDraft] !== initialMetadata[field as keyof MetadataDraft],
  );

  useEffect(() => {
    if (!metadataDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [metadataDirty]);

  function resetMetadata() {
    if (!window.confirm("Discard the unsaved metadata draft?")) return;
    setMetadata(initialMetadata);
  }

  return (
    <fieldset aria-busy={!interactive} className="min-w-0 space-y-12" disabled={!interactive}>
      <legend className="sr-only">Editor preview controls</legend>
      <section aria-labelledby="metadata-editor-title" id="metadata-draft" className="scroll-mt-28">
        <h2 id="metadata-editor-title" className="font-heading text-3xl font-medium">Edit metadata</h2>
        <p className="mt-2 max-w-[70ch] text-sm leading-6 text-muted-foreground">
          Try changes to the displayed title, description, and inventory numbers. Metadata publishing is not available yet.
        </p>
        <div className="mt-7 grid gap-8 lg:grid-cols-2">
          <div className="space-y-5">
            <div>
              <Label htmlFor="draft-record-title">Record title</Label>
              <input
                className="mt-2 min-h-11 w-full border border-input bg-background px-3 text-sm"
                id="draft-record-title"
                onChange={(event) => setMetadata({ ...metadata, title: event.target.value })}
                value={metadata.title}
              />
            </div>
            <div>
              <Label htmlFor="draft-description">Description</Label>
              <Textarea
                className="mt-2 min-h-28 rounded-none bg-background"
                id="draft-description"
                onChange={(event) => setMetadata({ ...metadata, description: event.target.value })}
                value={metadata.description}
              />
            </div>
            <div>
              <Label htmlFor="draft-inventory">Inventory numbers</Label>
              <Textarea
                aria-describedby="inventory-help"
                className="mt-2 min-h-24 rounded-none bg-background"
                id="draft-inventory"
                onChange={(event) => setMetadata({ ...metadata, inventoryNumbers: event.target.value })}
                value={metadata.inventoryNumbers}
              />
              <p className="mt-2 text-xs leading-5 text-muted-foreground" id="inventory-help">Enter one inventory number per line.</p>
            </div>
          </div>
          <section aria-labelledby="metadata-preview-title" className="min-w-0 border border-border bg-card p-5 sm:p-7">
            <h3 className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase" id="metadata-preview-title">Metadata preview</h3>
            <p className="mt-5 break-words font-heading text-3xl leading-tight">{metadata.title || "Untitled draft"}</p>
            <p className="mt-4 break-words leading-7 whitespace-pre-wrap text-muted-foreground">{metadata.description || "No description in this draft."}</p>
            <dl className="mt-6 border-t border-border pt-4">
              <dt className="text-xs font-medium text-muted-foreground">Inventory numbers</dt>
              <dd className="mt-2 break-words text-sm whitespace-pre-wrap">{metadata.inventoryNumbers || "No inventory number in this draft."}</dd>
            </dl>
          </section>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button aria-describedby="metadata-save-help" className="min-h-11 rounded-none" disabled type="button">Save metadata</Button>
          <Button className="min-h-11 rounded-none" disabled={!metadataDirty} onClick={resetMetadata} type="button" variant="outline">Reset metadata draft</Button>
          <span aria-live="polite" className="text-sm text-muted-foreground">{metadataDirty ? "Metadata draft changed · not saved" : "Metadata preview ready"}</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground" id="metadata-save-help">These fields are a preview only, including when you are signed in.</p>
      </section>

      <div className="scroll-mt-28" id="transliteration-draft">
        {editions.length > 1 ? (
          <div className="mb-6 max-w-xl">
            <Label htmlFor="preview-edition">Edition to preview</Label>
            <select
              className="mt-2 min-h-11 w-full border border-input bg-background px-3 text-sm"
              id="preview-edition"
              onChange={(event) => setEditionIndex(Number(event.target.value))}
              value={editionIndex}
            >
              {editions.map((edition, index) => <option key={edition.id} value={index}>{edition.label}</option>)}
            </select>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Each edition keeps its own draft while this page is open.</p>
          </div>
        ) : null}
        {editions.map((edition, index) => (
          <div hidden={index !== editionIndex} key={edition.id}>
            <TransliterationEditor
              historyUrl={edition.historyUrl}
              initialText={edition.text}
              previewDescription={edition.description}
              previewOnly
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}
