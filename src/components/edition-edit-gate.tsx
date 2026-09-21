"use client";

import { useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";

import { TransliterationEditor } from "@/components/transliteration-editor";

type State =
  | { status: "checking" }
  | { status: "target-denied" }
  | { status: "unavailable" }
  | { status: "anonymous" }
  | { status: "editing-disabled" }
  | { status: "denied"; username: string }
  | { status: "allowed"; csrfToken: string };

export interface EditionEditGateProps {
  qid: string;
  editionId: string;
  initialText: string;
  initialRevision: number;
  historyUrl: string;
  targetEnabled: boolean;
}

export function EditionEditGate(props: EditionEditGateProps) {
  const [state, setState] = useState<State>(
    props.targetEnabled ? { status: "checking" } : { status: "target-denied" },
  );

  useEffect(() => {
    if (!props.targetEnabled) return;
    const controller = new AbortController();
    fetch("/api/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) return { status: "unavailable" } as const;
        if (!response.ok) return { status: "unavailable" } as const;
        const body = (await response.json()) as {
          authenticated?: boolean;
          csrfToken?: string;
          editingEnabled?: boolean;
          editorApproved?: boolean;
          user?: { username?: string };
        };
        if (!body.authenticated) return { status: "anonymous" } as const;
        if (body.editingEnabled === false) return { status: "editing-disabled" } as const;
        if (!body.editorApproved || !body.csrfToken) {
          return { status: "denied", username: body.user?.username ?? "this account" } as const;
        }
        return { status: "allowed", csrfToken: body.csrfToken } as const;
      })
      .then(setState)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "unavailable" });
      });
    return () => controller.abort();
  }, [props.targetEnabled]);

  if (state.status === "allowed") {
    return <TransliterationEditor {...props} csrfToken={state.csrfToken} />;
  }

  if (state.status === "checking") {
    return <p aria-live="polite" className="mt-8 text-sm text-muted-foreground">Checking edit access…</p>;
  }

  const message =
    state.status === "target-denied"
      ? "This document is readable, but it is not on this deployment’s approved edit-target list."
      : state.status === "unavailable"
        ? "Editing is not configured for this deployment. Reading and source links remain available."
        : state.status === "editing-disabled"
          ? "Editing is currently disabled for this deployment. Reading and source links remain available."
        : state.status === "anonymous"
          ? "Sign in with FactGrid to check whether this edition can be edited."
          : `${state.username} is signed in, but is not on this interface’s approved editor list.`;

  return (
    <div className="mt-8 flex gap-3 border-t border-border pt-5 text-sm leading-6 text-muted-foreground">
      <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        {message}{" "}
        {state.status === "anonymous" ? (
          <a className="font-medium text-foreground underline underline-offset-4" href={`/api/auth/login?returnTo=${encodeURIComponent(`/tablets/${props.qid}`)}`}>
            Sign in
          </a>
        ) : null}
      </p>
    </div>
  );
}
