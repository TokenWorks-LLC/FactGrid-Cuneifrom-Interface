"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

type DraftRegistration = {
  dirty: boolean;
  discard: () => void;
};

type DraftProtectionContextValue = {
  confirmDiscard: (message?: string) => boolean;
  discardAll: () => void;
  register: (id: string, registration: DraftRegistration) => () => void;
};

const DraftProtectionContext = createContext<DraftProtectionContextValue | null>(null);
const STORAGE_PREFIX = "factgrid:draft:v1:";
const DEFAULT_WARNING = "Discard your unsaved FactGrid draft and leave this page?";

function storageKey(ownerId: string, scope: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(scope)}`;
}

export function readStoredDraft<T>(ownerId: string, scope: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.sessionStorage.getItem(storageKey(ownerId, scope));
    return value ? JSON.parse(value) as T : undefined;
  } catch {
    return undefined;
  }
}

function removeStoredDraft(ownerId: string, scope: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(ownerId, scope));
  } catch {
    // Draft persistence is a best-effort recovery layer. Navigation protection
    // remains active when storage is unavailable.
  }
}

export function DraftProtectionProvider({ children }: { children: ReactNode }) {
  const registrations = useRef(new Map<string, DraftRegistration>());

  const discardAll = useCallback(() => {
    const current = [...registrations.current.values()].filter((entry) => entry.dirty);
    registrations.current.clear();
    for (const entry of current) entry.discard();
  }, []);

  const confirmDiscard = useCallback((message = DEFAULT_WARNING) => {
    if (![...registrations.current.values()].some((entry) => entry.dirty)) return true;
    return window.confirm(message);
  }, []);

  const register = useCallback((id: string, registration: DraftRegistration) => {
    registrations.current.set(id, registration);
    return () => {
      if (registrations.current.get(id) === registration) registrations.current.delete(id);
    };
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (![...registrations.current.values()].some((entry) => entry.dirty)) return;
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === "_blank" || target.hasAttribute("download")) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const current = new URL(window.location.href);
      if (destination.pathname === current.pathname && destination.search === current.search) return;
      if (confirmDiscard()) {
        discardAll();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [confirmDiscard, discardAll]);

  const value = useMemo(
    () => ({ confirmDiscard, discardAll, register }),
    [confirmDiscard, discardAll, register],
  );
  return <DraftProtectionContext.Provider value={value}>{children}</DraftProtectionContext.Provider>;
}

export function useDraftProtection<T>({
  ownerId,
  scope,
  dirty,
  draft,
  onDiscard,
}: {
  ownerId: string;
  scope: string;
  dirty: boolean;
  draft: T;
  onDiscard: () => void;
}) {
  const context = useContext(DraftProtectionContext);
  if (!context) throw new Error("useDraftProtection must be used inside DraftProtectionProvider");
  const discardRef = useRef(onDiscard);
  const id = `${ownerId}\0${scope}`;

  useEffect(() => {
    discardRef.current = onDiscard;
  }, [onDiscard]);

  useEffect(() => context.register(id, {
    dirty,
    discard: () => {
      removeStoredDraft(ownerId, scope);
      discardRef.current();
    },
  }), [context, dirty, id, ownerId, scope]);

  useEffect(() => {
    if (!dirty) {
      removeStoredDraft(ownerId, scope);
      return;
    }
    try {
      window.sessionStorage.setItem(storageKey(ownerId, scope), JSON.stringify(draft));
    } catch {
      // Keep the in-memory and beforeunload protections when storage is full or disabled.
    }
  }, [dirty, draft, ownerId, scope]);
}

export function useDraftNavigation() {
  const context = useContext(DraftProtectionContext);
  if (!context) throw new Error("useDraftNavigation must be used inside DraftProtectionProvider");
  return context;
}
