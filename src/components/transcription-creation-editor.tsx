"use client";

import { useId, useRef, useState } from "react";
import { AlertTriangle, Check, ExternalLink, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { readStoredDraft, useDraftProtection } from "@/components/draft-protection";
import { FACTGRID } from "@/lib/factgrid/constants";

type CreateState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; message: string; title?: string; url?: string }
  | { status: "partial"; message: string; title?: string; url?: string }
  | { status: "unknown" | "conflict" | "error"; message: string };

type CreationPayload = { text: string; summary: string };
type PartialRecovery = { status: "partial"; message: string; title?: string; url?: string; payload: CreationPayload };
type StoredCreationDraft = CreationPayload & {
  outcome?:
    | { status: "unknown"; message: string }
    | PartialRecovery;
};

export function TranscriptionCreationEditor({
  qid,
  csrfToken,
  ownerId,
}: {
  qid: string;
  csrfToken: string;
  ownerId: string;
}) {
  const id = useId();
  const router = useRouter();
  const alertRef = useRef<HTMLDivElement>(null);
  const scope = `transcription-creation:${qid}`;
  const [restored] = useState(() => readStoredDraft<StoredCreationDraft>(ownerId, scope));
  const [text, setText] = useState(restored?.text ?? "");
  const [summary, setSummary] = useState(restored?.summary ?? "");
  const [partialRecovery, setPartialRecovery] = useState<PartialRecovery | undefined>(
    restored?.outcome?.status === "partial" ? restored.outcome : undefined,
  );
  const [state, setState] = useState<CreateState>(() => {
    const outcome = restored?.outcome;
    return outcome?.status === "partial"
      ? { status: "partial", message: outcome.message, title: outcome.title, url: outcome.url }
      : outcome?.status === "unknown"
        ? { status: "unknown", message: outcome.message }
        : { status: "idle" };
  });
  const dirty = text.length > 0 || summary.length > 0;
  const protectedDirty = dirty && state.status !== "saved";
  const outcomeLocked = state.status === "unknown";

  useDraftProtection({
    ownerId,
    scope,
    dirty: protectedDirty,
    draft: {
      text,
      summary,
      outcome: partialRecovery && state.status !== "saved"
        ? partialRecovery
        : state.status === "unknown"
          ? { status: "unknown" as const, message: state.message }
          : undefined,
    },
    onDiscard: () => {
      setText("");
      setSummary("");
      setPartialRecovery(undefined);
      setState({ status: "idle" });
    },
  });

  async function createOrResume() {
    if (!text.trim() || state.status === "saving" || state.status === "unknown") return;
    const payload = partialRecovery
      ? partialRecovery.payload
      : { text, summary };
    setState({ status: "saving" });
    try {
      const response = await fetch(`/api/tablets/${encodeURIComponent(qid)}/transcription`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as {
        status?: "created_and_linked" | "created" | "already_available";
        saveStatus?: "unknown" | "accepted_unconfirmed" | "partial";
        title?: string;
        url?: string;
        message?: string;
        recovery?: { title?: string; url?: string; nextAction?: string };
        error?: { message?: string };
      };
      const message = body.message ?? body.error?.message;
      if (body.saveStatus === "partial") {
        const partial = { status: "partial" as const, message: message ?? "The document was created, but FactGrid has not linked it to this tablet yet. Use Finish linking to reconcile this operation safely.", title: body.recovery?.title ?? body.title, url: body.recovery?.url ?? body.url, payload };
        setPartialRecovery(partial);
        setState({ status: "partial", message: partial.message, title: partial.title, url: partial.url });
        requestAnimationFrame(() => alertRef.current?.focus());
        return;
      }
      if (body.saveStatus === "unknown" || body.saveStatus === "accepted_unconfirmed") {
        setState({ status: "unknown", message: message ?? "FactGrid may have accepted this request, but its outcome is unknown. Check FactGrid before retrying." });
        requestAnimationFrame(() => alertRef.current?.focus());
        return;
      }
      if (response.status === 409) {
        setState({ status: "conflict", message: message ?? "The tablet changed before this transcription could be linked. Your draft is preserved." });
        requestAnimationFrame(() => alertRef.current?.focus());
        return;
      }
      if (!response.ok || !["created_and_linked", "created", "already_available"].includes(body.status ?? "")) {
        setState({ status: "error", message: message ?? "FactGrid did not confirm transcription creation. Your draft is preserved." });
        requestAnimationFrame(() => alertRef.current?.focus());
        return;
      }
      setState({ status: "saved", message: message ?? "The transcription document was created and linked to this tablet.", title: body.title, url: body.url });
      setPartialRecovery(undefined);
      setSummary("");
      router.refresh();
    } catch {
      setState({ status: "unknown", message: "The response was interrupted, so the creation status is unknown. Your draft is preserved. Check FactGrid before trying again." });
      requestAnimationFrame(() => alertRef.current?.focus());
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="border-t border-border pt-8" id="transliteration-draft">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-heading text-3xl font-medium" id={`${id}-title`}>Add transcription</h2>
        <a className="focus-ring inline-flex min-h-11 items-center gap-2 text-sm font-medium underline underline-offset-4" href={`${FACTGRID.wikiBase}Item:${qid}?action=history`} rel="noreferrer" target="_blank">FactGrid item history<ExternalLink aria-hidden="true" className="size-4" /></a>
      </div>
      <p className="mt-2 max-w-[70ch] text-sm leading-6 text-muted-foreground">
        FactGrid will derive the document title, create it without overwriting an existing page, and then link the confirmed document to this tablet.
      </p>
      <div className="mt-7 grid min-w-0 gap-8 xl:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor={`${id}-text`}>Transliteration source</Label>
          <Textarea className="transcript-text mt-2 min-h-72 resize-y rounded-none bg-card text-base leading-6 md:min-h-96 md:text-sm" disabled={state.status === "saved" || outcomeLocked || Boolean(partialRecovery)} id={`${id}-text`} onChange={(event) => { setText(event.target.value); if (!["idle", "partial", "unknown"].includes(state.status)) setState({ status: "idle" }); }} spellCheck={false} value={text} />
          <div className="mt-5"><Label htmlFor={`${id}-summary`}>Edit summary</Label><input className="mt-2 min-h-11 w-full border border-input bg-background px-3 text-base md:text-sm" disabled={state.status === "saved" || outcomeLocked || Boolean(partialRecovery)} id={`${id}-summary`} maxLength={255} onChange={(event) => setSummary(event.target.value)} placeholder="Describe this new transcription" value={summary} /></div>
        </div>
        <div className="min-w-0"><p className="text-sm font-medium">Plain-text preview</p><pre aria-label="Plain-text preview" className="transcript-text mt-2 min-h-72 overflow-x-auto border border-border bg-card p-5 text-sm leading-6 break-words whitespace-pre-wrap md:min-h-96">{text || "The transcription is empty."}</pre></div>
      </div>
      {state.status !== "idle" && state.status !== "saving" ? (
        <div className="mt-6" ref={alertRef} tabIndex={state.status === "saved" ? undefined : -1}>
          <Alert className="rounded-none" variant={state.status === "saved" ? "default" : "destructive"}>
            {state.status === "saved" ? <Check aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
            <AlertTitle>{state.status === "saved" ? "Creation confirmed" : state.status === "partial" ? "Document created; link pending" : state.status === "conflict" ? "Revision conflict" : "Draft not cleared"}</AlertTitle>
            <AlertDescription><p>{state.message}</p>{"url" in state && state.url ? <a className="mt-2 inline-flex items-center gap-2 font-medium" href={state.url} rel="noreferrer" target="_blank">Open {state.title ?? "created document"}<ExternalLink aria-hidden="true" /></a> : "title" in state && state.title ? <p className="mt-2 break-all font-mono">{state.title}</p> : null}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button aria-busy={state.status === "saving"} className="min-h-11 rounded-none" disabled={!text.trim() || state.status === "saving" || state.status === "saved" || state.status === "unknown"} onClick={createOrResume} type="button">{state.status === "saving" ? <><LoaderCircle aria-hidden="true" className="animate-spin" /> Saving…</> : partialRecovery ? "Finish linking" : "Create and link on FactGrid"}</Button>
        <Button className="min-h-11 rounded-none" disabled={!dirty || state.status === "saving" || state.status === "saved"} onClick={() => { if (!window.confirm("Discard this unsaved transcription draft?")) return; setText(""); setSummary(""); setPartialRecovery(undefined); setState({ status: "idle" }); }} type="button" variant="outline">Discard draft</Button>
        <span aria-live="polite" className="text-sm text-muted-foreground" role="status">{state.status === "saving" ? "Submitting to FactGrid…" : state.status === "partial" ? "The same operation can safely resume linking." : state.status === "unknown" ? "Do not retry until FactGrid history has been checked." : dirty && state.status !== "saved" ? "Unsaved transcription draft" : "Ready"}</span>
      </div>
    </section>
  );
}
