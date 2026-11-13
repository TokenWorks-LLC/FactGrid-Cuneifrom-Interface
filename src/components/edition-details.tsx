"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native details remain usable without JavaScript; hash navigation opens the requested text. */
export function EditionDetails({ anchor, expandedByDefault, children }: {
  anchor: string; expandedByDefault: boolean; children: ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function openRequestedEdition() {
      if (window.location.hash !== `#${anchor}` || !details.current) return;
      details.current.open = true;
      document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    }
    openRequestedEdition();
    window.addEventListener("hashchange", openRequestedEdition);
    return () => window.removeEventListener("hashchange", openRequestedEdition);
  }, [anchor]);
  return <details className="group mt-6" open={expandedByDefault} ref={details}>{children}</details>;
}
