"use client";

import { useSyncExternalStore } from "react";

interface ClientEventLocalDateProps {
  value: string;
  includeTime?: boolean;
}

function subscribeToLocaleChange(onChange: () => void) {
  window.addEventListener("languagechange", onChange);
  return () => window.removeEventListener("languagechange", onChange);
}

function getServerSnapshot() {
  return "";
}

export function ClientEventLocalDate({
  value,
  includeTime = false,
}: ClientEventLocalDateProps) {
  const formatted = useSyncExternalStore(
    subscribeToLocaleChange,
    () => {
      const date = new Date(value);
      if (Number.isNaN(date.valueOf())) return "";
      return includeTime
        ? date.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })
        : date.toLocaleDateString();
    },
    getServerSnapshot,
  );

  return <>{formatted}</>;
}
