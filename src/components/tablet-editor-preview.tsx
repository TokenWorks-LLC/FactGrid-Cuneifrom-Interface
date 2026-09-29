"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, LoaderCircle, LockKeyhole } from "lucide-react";

import { MetadataEditor, type MetadataModel } from "@/components/metadata-editor";
import { TranscriptionCreationEditor } from "@/components/transcription-creation-editor";
import { TransliterationEditor } from "@/components/transliteration-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

type AccessState =
  | { status: "checking" }
  | { status: "loading-model"; csrfToken: string }
  | { status: "ready"; csrfToken: string; model: MetadataModel }
  | { status: "preview"; reason: "anonymous" | "unavailable" | "disabled" | "denied" | "model-error"; message: string };

const subscribeToHydration = () => () => undefined;
const getHydratedSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

function PreviewMetadata({ initialMetadata }: { initialMetadata: MetadataDraft }) {
  const [metadata, setMetadata] = useState(initialMetadata);
  const metadataDirty = Object.keys(initialMetadata).some((field) => metadata[field as keyof MetadataDraft] !== initialMetadata[field as keyof MetadataDraft]);
  useEffect(() => {
    if (!metadataDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [metadataDirty]);
  return (
    <section aria-labelledby="metadata-editor-title" id="metadata-draft" className="scroll-mt-28">
      <h2 id="metadata-editor-title" className="font-heading text-3xl font-medium">Try metadata changes</h2>
      <p className="mt-2 max-w-[70ch] text-sm leading-6 text-muted-foreground">This local preview includes the displayed title, description, and inventory numbers. It never sends mutation requests.</p>
      <div className="mt-7 grid min-w-0 gap-8 lg:grid-cols-2">
        <div className="min-w-0 space-y-5">
          <div><Label htmlFor="draft-record-title">Record title</Label><input className="mt-2 min-h-11 w-full min-w-0 border border-input bg-background px-3 text-base md:text-sm" id="draft-record-title" onChange={(event) => setMetadata({ ...metadata, title: event.target.value })} value={metadata.title} /></div>
          <div><Label htmlFor="draft-description">Description</Label><Textarea className="mt-2 min-h-28 rounded-none bg-background text-base md:text-sm" id="draft-description" onChange={(event) => setMetadata({ ...metadata, description: event.target.value })} value={metadata.description} /></div>
          <div><Label htmlFor="draft-inventory">Inventory numbers</Label><Textarea aria-describedby="inventory-help" className="mt-2 min-h-24 rounded-none bg-background text-base md:text-sm" id="draft-inventory" onChange={(event) => setMetadata({ ...metadata, inventoryNumbers: event.target.value })} value={metadata.inventoryNumbers} /><p className="mt-2 text-xs leading-5 text-muted-foreground" id="inventory-help">Enter one inventory number per line.</p></div>
        </div>
        <section aria-labelledby="metadata-preview-title" className="min-w-0 border border-border bg-card p-5 sm:p-7"><h3 className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase" id="metadata-preview-title">Metadata preview</h3><p className="mt-5 break-words font-heading text-3xl leading-tight">{metadata.title || "Untitled draft"}</p><p className="mt-4 break-words leading-7 whitespace-pre-wrap text-muted-foreground">{metadata.description || "No description in this draft."}</p><dl className="mt-6 border-t border-border pt-4"><dt className="text-xs font-medium text-muted-foreground">Inventory numbers</dt><dd className="mt-2 break-words text-sm whitespace-pre-wrap">{metadata.inventoryNumbers || "No inventory number in this draft."}</dd></dl></section>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3"><Button aria-describedby="metadata-save-help" className="min-h-11 rounded-none" disabled type="button">Save metadata</Button><Button className="min-h-11 rounded-none" disabled={!metadataDirty} onClick={() => { if (!window.confirm("Discard the unsaved metadata draft?")) return; setMetadata(initialMetadata); }} type="button" variant="outline">Reset metadata draft</Button><span aria-live="polite" className="text-sm text-muted-foreground" role="status">{metadataDirty ? "Local metadata draft changed · not saved" : "Local preview ready"}</span></div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground" id="metadata-save-help">Sign in with an eligible FactGrid account to load the complete entity and save changes.</p>
    </section>
  );
}

function AccessBanner({ state, qid }: { state: AccessState; qid: string }) {
  if (state.status === "checking" || state.status === "loading-model") return <Alert className="mb-8 rounded-none"><LoaderCircle aria-hidden="true" className="animate-spin" /><AlertTitle><h2>{state.status === "checking" ? "Checking edit access" : "Loading the current FactGrid entity"}</h2></AlertTitle><AlertDescription>Please wait before starting a draft so the editor can establish the correct mode.</AlertDescription></Alert>;
  if (state.status === "ready") return <Alert className="mb-8 rounded-none"><CheckCircle2 aria-hidden="true" /><AlertTitle><h2>Editing FactGrid</h2></AlertTitle><AlertDescription>You are editing revision {state.model.entity.lastRevision}. Confirmed saves are attributed to your signed-in FactGrid account.</AlertDescription></Alert>;
  return <Alert className="mb-8 rounded-none"><LockKeyhole aria-hidden="true" /><AlertTitle><h2>Local draft preview</h2></AlertTitle><AlertDescription>{state.message} Nothing typed in this mode is sent to FactGrid. {state.reason === "anonymous" ? <a className="font-medium" href={`/api/auth/login?returnTo=${encodeURIComponent(`/tablets/${qid}/edit`)}`}>Log in with FactGrid</a> : null}</AlertDescription></Alert>;
}

export function TabletEditorPreview({
  qid,
  initialMetadata,
  editions,
  offerTranscriptionCreation,
}: {
  qid: string;
  initialMetadata: MetadataDraft;
  editions: PreviewEdition[];
  offerTranscriptionCreation: boolean;
}) {
  const [editionIndex, setEditionIndex] = useState(0);
  const interactive = useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerHydrationSnapshot);
  const [access, setAccess] = useState<AccessState>({ status: "checking" });

  useEffect(() => {
    if (!interactive) return;
    const controller = new AbortController();
    fetch("/api/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503 || !response.ok) return { status: "preview", reason: "unavailable", message: "FactGrid sign-in or the session service is unavailable on this deployment." } as const;
        const body = await response.json() as { authenticated?: boolean; csrfToken?: string; editingEnabled?: boolean; editorApproved?: boolean; canEdit?: boolean; user?: { username?: string } };
        if (!body.authenticated) return { status: "preview", reason: "anonymous", message: "You are not signed in." } as const;
        if (body.editingEnabled === false) return { status: "preview", reason: "disabled", message: "Authenticated editing is currently disabled for this deployment." } as const;
        if ((!body.editorApproved && !body.canEdit) || !body.csrfToken) return { status: "preview", reason: "denied", message: `${body.user?.username ?? "This account"} is signed in but is not eligible to edit through this deployment.` } as const;
        return { status: "loading-model", csrfToken: body.csrfToken } as const;
      })
      .then(async (state) => {
        if (state.status !== "loading-model") return state;
        setAccess(state);
        const response = await fetch(`/api/tablets/${encodeURIComponent(qid)}/metadata`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return { status: "preview", reason: "model-error", message: "The complete FactGrid entity could not be loaded safely, so this page remains a local preview." } as const;
        const model = await response.json() as MetadataModel;
        if (!model.entity || !model.properties) return { status: "preview", reason: "model-error", message: "FactGrid returned an incomplete edit model, so this page remains a local preview." } as const;
        return { status: "ready", csrfToken: state.csrfToken, model } as const;
      })
      .then(setAccess)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAccess({ status: "preview", reason: "model-error", message: "The editor could not confirm access or load the current entity, so this page remains a local preview." });
      });
    return () => controller.abort();
  }, [interactive, qid]);

  const established = access.status !== "checking" && access.status !== "loading-model";
  return (
    <div aria-busy={!established} className="min-w-0 space-y-12">
      <AccessBanner qid={qid} state={access} />
      {access.status === "ready" ? <MetadataEditor csrfToken={access.csrfToken} initialModel={access.model} qid={qid} /> : established ? <PreviewMetadata initialMetadata={initialMetadata} /> : null}
      {established ? (
        <div className="scroll-mt-28" id="transliteration-draft">
          {access.status === "ready" && offerTranscriptionCreation ? <TranscriptionCreationEditor csrfToken={access.csrfToken} qid={qid} /> : (
            <>
              {editions.length > 1 ? <div className="mb-6 max-w-xl"><Label htmlFor="preview-edition">Edition to preview</Label><select className="mt-2 min-h-11 w-full border border-input bg-background px-3 text-base md:text-sm" id="preview-edition" onChange={(event) => setEditionIndex(Number(event.target.value))} value={editionIndex}>{editions.map((edition, index) => <option key={edition.id} value={index}>{edition.label}</option>)}</select><p className="mt-2 text-xs leading-5 text-muted-foreground">Each edition keeps its own local draft while this page is open.</p></div> : null}
              {access.status === "ready" && !offerTranscriptionCreation ? <p className="mb-5 max-w-[70ch] border-l-2 border-primary pl-4 text-sm leading-6 text-muted-foreground">Existing supported transcriptions retain their revision-aware editor on the tablet record page. The controls below are a local preview and cannot overwrite unsupported or structured sources.</p> : null}
              {editions.map((edition, index) => <div hidden={index !== editionIndex} key={edition.id}><TransliterationEditor historyUrl={edition.historyUrl} initialText={edition.text} previewDescription={edition.description} previewOnly /></div>)}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
