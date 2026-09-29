"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, LockKeyhole } from "lucide-react";

import { MetadataEditor, type MetadataModel } from "@/components/metadata-editor";
import { TranscriptionCreationEditor } from "@/components/transcription-creation-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type AccessState =
  | { status: "checking" }
  | { status: "ready"; csrfToken: string; model: MetadataModel }
  | { status: "blocked"; title: string; message: string; href?: string; linkText?: string };

export function TabletEditor({
  qid,
  offerTranscriptionCreation,
}: {
  qid: string;
  offerTranscriptionCreation: boolean;
}) {
  const [access, setAccess] = useState<AccessState>({ status: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    const options = { cache: "no-store", signal: controller.signal } as const;

    async function loadEditor(): Promise<AccessState> {
      const response = await fetch("/api/session", options);
      if (!response.ok) return {
        status: "blocked",
        title: "Editing unavailable",
        message: "FactGrid sign-in or the session service is unavailable. You can still read the tablet record.",
        href: "/about#sign-in-availability",
        linkText: "About FactGrid sign-in",
      };
      const session = await response.json() as {
        authenticated?: boolean;
        csrfToken?: string;
        editingEnabled?: boolean;
        editorApproved?: boolean;
      };
      if (!session.authenticated) return {
        status: "blocked",
        title: "Sign in to edit",
        message: "Editing metadata and transcriptions requires a FactGrid account with permission to contribute.",
        href: `/api/auth/login?returnTo=${encodeURIComponent(`/tablets/${qid}/edit`)}`,
        linkText: "Log in with FactGrid",
      };
      if (session.editingEnabled !== true) return {
        status: "blocked",
        title: "Editing disabled",
        message: "You are signed in, but editing is currently disabled for this deployment.",
      };
      if (session.editorApproved !== true || !session.csrfToken) return {
        status: "blocked",
        title: "Editing not permitted",
        message: "Your account is signed in but is not eligible to edit through this deployment.",
      };

      const modelResponse = await fetch(`/api/tablets/${encodeURIComponent(qid)}/metadata`, options);
      if (!modelResponse.ok) throw new Error("Metadata unavailable");
      const model = await modelResponse.json() as MetadataModel;
      if (!model.entity || !model.properties) throw new Error("Incomplete metadata");
      return { status: "ready", csrfToken: session.csrfToken, model };
    }

    loadEditor()
      .then((state) => { if (!controller.signal.aborted) setAccess(state); })
      .catch(() => {
        if (controller.signal.aborted) return;
        setAccess({
          status: "blocked",
          title: "Editor could not be loaded",
          message: "The session or current FactGrid record could not be loaded. Reload the page to try again.",
          href: `/tablets/${qid}/edit`,
          linkText: "Reload editor",
        });
      });
    return () => controller.abort();
  }, [qid]);

  if (access.status !== "ready") return (
    <Alert aria-busy={access.status === "checking"} className="rounded-none">
      {access.status === "checking" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <LockKeyhole aria-hidden="true" />}
      <AlertTitle><h2>{access.status === "checking" ? "Checking edit access" : access.title}</h2></AlertTitle>
      <AlertDescription>
        {access.status === "checking" ? "The editor opens after your sign-in and edit access are confirmed." : access.message}
        {access.status === "blocked" && access.href ? (
          <div><a className="focus-ring mt-2 inline-flex min-h-11 items-center font-medium" href={access.href}>{access.linkText}</a></div>
        ) : null}
      </AlertDescription>
    </Alert>
  );

  return (
    <div className="min-w-0 space-y-8">
      <Alert className="rounded-none">
        <CheckCircle2 aria-hidden="true" />
        <AlertTitle><h2>Editing FactGrid</h2></AlertTitle>
        <AlertDescription>Confirmed saves are attributed to your signed-in FactGrid account.</AlertDescription>
      </Alert>
      <MetadataEditor csrfToken={access.csrfToken} initialModel={access.model} qid={qid} />
      {offerTranscriptionCreation ? <TranscriptionCreationEditor csrfToken={access.csrfToken} qid={qid} /> : (
        <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
          To edit an existing transcription, open its edition on the{" "}
          <a className="font-medium text-foreground underline underline-offset-4" href={`/tablets/${qid}#edition-1`}>tablet record</a>.
          {" "}Unsupported source formats remain read-only.
        </p>
      )}
    </div>
  );
}
