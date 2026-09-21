"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SessionStatus =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "anonymous" }
  | { status: "authenticated"; username: string; csrfToken: string };

export function AuthControl() {
  const router = useRouter();
  const [session, setSession] = useState<SessionStatus>({ status: "loading" });
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) return { status: "unavailable" } as const;
        if (!response.ok) return { status: "unavailable" } as const;
        const body = (await response.json()) as {
          authenticated?: boolean;
          csrfToken?: string;
          user?: { username?: string };
        };
        return body.authenticated && body.user?.username && typeof body.csrfToken === "string"
          ? ({
              status: "authenticated",
              username: body.user.username,
              csrfToken: body.csrfToken,
            } as const)
          : ({ status: "anonymous" } as const);
      })
      .then(setSession)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSession({ status: "unavailable" });
      });
    return () => controller.abort();
  }, []);

  if (session.status === "loading") {
    return <span aria-label="Checking sign-in availability" className="h-9 w-20 animate-pulse bg-muted" />;
  }

  if (session.status === "unavailable") {
    return (
      <Link
        aria-label="Reading only; editing is unavailable. Learn why."
        className="focus-ring min-h-11 content-center font-mono text-xs tracking-[0.06em] text-muted-foreground uppercase underline decoration-border underline-offset-4"
        href="/about#contribution-status"
      >
        Reading only
      </Link>
    );
  }

  if (session.status === "authenticated") {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-28 truncate text-sm font-medium sm:inline">{session.username}</span>
        {logoutError ? (
          <span className="max-w-48 text-xs leading-4 text-destructive" id="logout-error" role="alert">
            {logoutError}
          </span>
        ) : null}
        <button
          aria-describedby={logoutError ? "logout-error" : undefined}
          className={cn(
            buttonVariants({ size: "sm", variant: "outline" }),
            "min-h-11 rounded-none px-3",
          )}
          onClick={async () => {
            setLogoutError(null);
            try {
              const response = await fetch("/api/auth/logout", {
                method: "POST",
                headers: { "X-CSRF-Token": session.csrfToken },
              });
              if (response.ok) {
                router.push("/");
                router.refresh();
                return;
              }
              const body = (await response.json().catch(() => ({}))) as {
                error?: { message?: string };
              };
              setLogoutError(
                body.error?.message ?? "Sign-out could not be confirmed. Please try again.",
              );
            } catch {
              setLogoutError("Sign-out could not be confirmed. Please try again.");
            }
          }}
          type="button"
        >
          <LogOut aria-hidden="true" className="size-4" />
          Sign out
        </button>
      </div>
    );
  }

  return (
    <a
      className={cn(
        buttonVariants({ size: "sm", variant: "outline" }),
        "min-h-11 rounded-none px-3",
      )}
      href="/api/auth/login"
    >
      <LogIn aria-hidden="true" className="size-4" />
      Sign in
    </a>
  );
}
