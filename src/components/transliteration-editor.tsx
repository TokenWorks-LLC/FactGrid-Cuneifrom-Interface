"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ExternalLink, LoaderCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SPECIAL_CHARACTERS = ["š", "ṣ", "ṭ", "ḫ", "ā", "ē", "ī", "ū", "ʾ", "₁", "₂", "₃", "₄"];

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; message: string }
  | { status: "error" | "conflict" | "unknown"; message: string };

export interface TransliterationEditorProps {
  qid: string;
  editionId: string;
  initialText: string;
  initialRevision: number;
  csrfToken: string;
  historyUrl: string;
}

export function TransliterationEditor({
  qid,
  editionId,
  initialText,
  initialRevision,
  csrfToken,
  historyUrl,
}: TransliterationEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [savedText, setSavedText] = useState(initialText);
  const [revision, setRevision] = useState(initialRevision);
  const [summary, setSummary] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const dirty = text !== savedText;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function insertCharacter(character: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setText(`${text.slice(0, start)}${character}${text.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + character.length, start + character.length);
    });
  }

  function cancelChanges() {
    if (dirty && !window.confirm("Discard the unsaved changes in this editor?")) return;
    setText(savedText);
    setSummary("");
    setSaveState({ status: "idle" });
  }

  async function save() {
    if (!dirty || saveState.status === "saving") return;
    setSaveState({ status: "saving" });

    try {
      const response = await fetch(
        `/api/tablets/${encodeURIComponent(qid)}/editions/${encodeURIComponent(editionId)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({ baseRevision: revision, text, summary }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        revisionId?: number;
        saveStatus?: "unknown" | "accepted_unconfirmed";
        text?: string;
      };

      if (response.status === 409) {
        if (body.saveStatus === "accepted_unconfirmed") {
          setSaveState({
            status: "unknown",
            message:
              body.message ??
              "FactGrid accepted the edit, but the saved revision could not be confirmed. Check page history before trying again.",
          });
          return;
        }
        setSaveState({
          status: "conflict",
          message: body.message ?? "FactGrid has a newer revision. Your draft is preserved; reload before saving.",
        });
        return;
      }

      if (body.saveStatus === "unknown" || body.saveStatus === "accepted_unconfirmed") {
        setSaveState({
          status: "unknown",
          message:
            body.message ??
            "FactGrid did not conclusively confirm the save. Check page history before trying again.",
        });
        return;
      }

      if (!response.ok || typeof body.revisionId !== "number" || typeof body.text !== "string") {
        setSaveState({
          status: "error",
          message: body.message ?? "FactGrid did not confirm the save. Your draft is preserved.",
        });
        return;
      }

      setText(body.text);
      setSavedText(body.text);
      setRevision(body.revisionId);
      setSummary("");
      setSaveState({ status: "saved", message: `Saved as revision ${body.revisionId}.` });
    } catch {
      setSaveState({
        status: "unknown",
        message:
          "The network response was interrupted, so the save status is unknown. Your draft is preserved. Check FactGrid history before trying again.",
      });
    }
  }

  return (
    <section aria-labelledby="editor-title" className="border-t border-border pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="editor-title" className="font-heading text-3xl font-medium">
            Edit transliteration
          </h2>
          <p className="mt-2 max-w-[65ch] text-sm leading-6 text-muted-foreground">
            Only the verified plain transcript region will change. Formatting and content outside that region remain byte-for-byte intact.
          </p>
        </div>
        <a
          className="focus-ring inline-flex min-h-11 items-center gap-2 text-sm font-medium underline underline-offset-4"
          href={historyUrl}
          rel="noreferrer"
          target="_blank"
        >
          FactGrid history
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
      </div>

      <div className="mt-7 grid gap-8 xl:grid-cols-2">
        <div>
          <Label htmlFor="transliteration">Transliteration source</Label>
          <div aria-label="Insert a special character" className="mt-3 flex flex-wrap gap-1.5">
            {SPECIAL_CHARACTERS.map((character) => (
              <Button
                key={character}
                aria-label={`Insert ${character}`}
                className="size-11 rounded-none font-heading text-base"
                onClick={() => insertCharacter(character)}
                size="icon"
                type="button"
                variant="outline"
              >
                {character}
              </Button>
            ))}
          </div>
          <Textarea
            ref={textareaRef}
            className="transcript-text mt-3 min-h-96 resize-y rounded-none bg-card text-sm leading-6"
            id="transliteration"
            onChange={(event) => {
              setText(event.target.value);
              if (saveState.status !== "idle") setSaveState({ status: "idle" });
            }}
            spellCheck={false}
            value={text}
          />
          <div className="mt-5">
            <Label htmlFor="edit-summary">Edit summary</Label>
            <input
              className="mt-2 h-11 w-full border border-input bg-background px-3 text-sm"
              id="edit-summary"
              maxLength={255}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Briefly describe this change"
              value={summary}
            />
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Plain-text preview</p>
          <pre className="transcript-text mt-3 min-h-96 overflow-x-auto border border-border bg-card p-5 text-sm leading-6 whitespace-pre-wrap">
            {text || "The transcript is empty."}
          </pre>
        </div>
      </div>

      {saveState.status !== "idle" && saveState.status !== "saving" ? (
        <Alert
          className="mt-6 rounded-none"
          variant={saveState.status === "saved" ? "default" : "destructive"}
        >
          {saveState.status === "saved" ? <Check aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <AlertTitle>{saveState.status === "saved" ? "Save confirmed" : "Draft not cleared"}</AlertTitle>
          <AlertDescription>{saveState.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button className="min-h-11 rounded-none" disabled={!dirty || saveState.status === "saving"} onClick={save} type="button">
          {saveState.status === "saving" ? (
            <>
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save to FactGrid"
          )}
        </Button>
        <Button className="min-h-11 rounded-none" disabled={!dirty || saveState.status === "saving"} onClick={cancelChanges} type="button" variant="outline">
          Cancel changes
        </Button>
        <span aria-live="polite" className="text-sm text-muted-foreground">
          {dirty ? "Unsaved changes" : `Revision ${revision}`}
        </span>
      </div>
    </section>
  );
}
