"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the page from the server every few seconds while background
 * work runs, only while the tab is visible and for at most `forMinutes`, so
 * an unattended tab doesn't keep the admin's session alive.
 */
export function AutoRefresh({ seconds = 5, forMinutes = 10 }: { seconds?: number; forMinutes?: number }) {
  const router = useRouter();
  useEffect(() => {
    const until = Date.now() + forMinutes * 60_000;
    const timer = setInterval(() => {
      if (Date.now() > until) clearInterval(timer);
      else if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds, forMinutes]);
  return null;
}
