"use client";

import { useEffect, useId, useState } from "react";
import { CircleUserRound, LogIn, LogOut } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SessionStatus =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "anonymous"; returnTo: string }
  | { status: "authenticated"; username: string; csrfToken: string };

function currentInternalDestination(): string {
  const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return destination.startsWith("/") && !destination.startsWith("//") ? destination : "/";
}

function loginHref(returnTo: string): string {
  return `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function AuthControl() {
  const pathname = usePathname();
  const router = useRouter();
  const logoutErrorId = useId();
  const [session, setSession] = useState<SessionStatus>({ status: "loading" });
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

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
          : ({ status: "anonymous", returnTo: currentInternalDestination() } as const);
      })
      .then(setSession)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSession({ status: "unavailable" });
      });
    return () => controller.abort();
  }, [pathname]);

  if (session.status === "loading") {
    return (
      <span
        aria-label="Log in with FactGrid"
        aria-busy="true"
        aria-live="polite"
        className={cn(
          buttonVariants({ size: "sm", variant: "outline" }),
          "min-h-11 w-full cursor-wait justify-between rounded-none px-3 lg:w-auto",
        )}
        role="status"
      >
        <span className="inline-flex items-center gap-1.5">
          <LogIn aria-hidden="true" className="size-4" />
          Log in with FactGrid
        </span>
        <span
          className="w-[5.5rem] text-right font-mono text-xs tracking-[0.06em] text-muted-foreground uppercase"
        >
          Checking…
        </span>
      </span>
    );
  }

  if (session.status === "unavailable") {
    return (
      <a
        aria-label="Log in with FactGrid"
        aria-describedby={`${logoutErrorId}-status`}
        className={cn(
          buttonVariants({ size: "sm", variant: "outline" }),
          "min-h-11 w-full justify-between rounded-none px-3 lg:w-auto",
        )}
        href="/about#sign-in-availability"
      >
        <span className="inline-flex items-center gap-1.5">
          <LogIn aria-hidden="true" className="size-4" />
          Log in with FactGrid
        </span>
        <span
          className="w-[5.5rem] text-right font-mono text-xs tracking-[0.06em] text-muted-foreground uppercase"
          id={`${logoutErrorId}-status`}
        >
          Unavailable
        </span>
      </a>
    );
  }

  if (session.status === "authenticated") {
    return (
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 lg:flex lg:w-auto">
        <span
          aria-label={`Signed in as ${session.username}`}
          className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium"
          title={session.username}
        >
          <CircleUserRound aria-hidden="true" className="size-4 shrink-0 text-primary" />
          <span className="max-w-32 truncate">{session.username}</span>
        </span>
        {logoutError ? (
          <span
            className="col-span-full max-w-full text-xs leading-4 text-destructive lg:order-last lg:col-auto lg:max-w-48"
            id={logoutErrorId}
            role="alert"
          >
            {logoutError}
          </span>
        ) : null}
        <button
          aria-describedby={logoutError ? logoutErrorId : undefined}
          aria-busy={loggingOut}
          className={cn(
            buttonVariants({ size: "sm", variant: "outline" }),
            "min-h-11 rounded-none px-3",
          )}
          onClick={async () => {
            setLogoutError(null);
            setLoggingOut(true);
            try {
              const response = await fetch("/api/auth/logout", {
                method: "POST",
                headers: { "X-CSRF-Token": session.csrfToken },
              });
              if (response.ok) {
                setSession({ status: "anonymous", returnTo: "/" });
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
            } finally {
              setLoggingOut(false);
            }
          }}
          disabled={loggingOut}
          type="button"
        >
          <LogOut aria-hidden="true" className="size-4" />
          {loggingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    );
  }

  return (
    <a
      className={cn(
        buttonVariants({ size: "sm", variant: "outline" }),
        "min-h-11 w-full rounded-none px-3 lg:w-auto",
      )}
      href={loginHref(session.returnTo)}
      onAuxClick={(event) => {
        event.currentTarget.href = loginHref(currentInternalDestination());
      }}
      onClick={(event) => {
        // Capture query and fragment at activation time while the server remains
        // authoritative for validating the same-origin return path.
        event.currentTarget.href = loginHref(currentInternalDestination());
      }}
      onContextMenu={(event) => {
        event.currentTarget.href = loginHref(currentInternalDestination());
      }}
      onFocus={(event) => {
        event.currentTarget.href = loginHref(currentInternalDestination());
      }}
      onPointerDown={(event) => {
        event.currentTarget.href = loginHref(currentInternalDestination());
      }}
    >
      <LogIn aria-hidden="true" className="size-4" />
      Log in with FactGrid
    </a>
  );
}
