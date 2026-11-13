"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/** A user-initiated refresh; never retries upstream work in a timer or effect. */
export function ReadRetryButton({ label = "Retry sources" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="focus-ring inline-flex min-h-11 items-center border border-border px-4 text-sm font-medium disabled:opacity-60"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      type="button"
    >
      {pending ? "Trying again…" : label}
    </button>
  );
}
