import { useState } from "react";
import { fetchWithCsrf } from "@/lib/csrf";
import type { TestOutcome } from "./directory-panel-shared";

// These probes use saved server credentials; unsaved password drafts never enter their payloads.
export function useDirectoryConnectionTests() {
  const [testingConnection, setTestingConnection] = useState<string | null>(
    null,
  );
  const [connectionOutcomes, setConnectionOutcomes] = useState<
    Record<string, TestOutcome>
  >({});
  const [testingBind, setTestingBind] = useState<string | null>(null);
  const [bindOutcomes, setBindOutcomes] = useState<Record<string, TestOutcome>>(
    {},
  );

  const runConnectionTest = async (url: string) => {
    if (!url.trim()) return;
    setTestingConnection(url);
    try {
      const response = await fetchWithCsrf(
        "/api/admin/config/directory/test-connection",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        },
      );
      const data = await response.json();
      const result = data?.result;
      if (!response.ok || !result?.ok)
        setConnectionOutcomes((previous) => ({
          ...previous,
          [url]: {
            ok: false,
            text: `${url} — ${result?.error || data?.error || "unreachable"}`,
          },
        }));
      else {
        const identity = [result.dnsHostName, result.namingContext]
          .filter(Boolean)
          .join(" · ");
        setConnectionOutcomes((previous) => ({
          ...previous,
          [url]: {
            ok: true,
            text: `Server detected${identity ? ` — ${identity}` : ""}${result.latencyMs != null ? ` (${result.latencyMs} ms)` : ""}${result.tlsVerified ? "" : " · certificate verification OFF"}`,
          },
        }));
      }
    } catch (error) {
      setConnectionOutcomes((previous) => ({
        ...previous,
        [url]: {
          ok: false,
          text: error instanceof Error ? error.message : "Test request failed",
        },
      }));
    } finally {
      setTestingConnection(null);
    }
  };

  const runBindTest = async (url?: string) => {
    const key = url || "(primary)";
    setTestingBind(key);
    try {
      const response = await fetchWithCsrf(
        "/api/admin/config/directory/test-bind",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(url ? { url } : {}),
        },
      );
      const data = await response.json();
      const result = data?.result;
      if (!response.ok)
        setBindOutcomes((previous) => ({
          ...previous,
          [key]: { ok: false, text: data?.error || "Bind test failed" },
        }));
      else if (result.ok)
        setBindOutcomes((previous) => ({
          ...previous,
          [key]: {
            ok: true,
            text: `Bind account works${result.searchOk ? ` and can read ${result.searchedBase}` : ""}${result.latencyMs != null ? ` (${result.latencyMs} ms)` : ""}`,
          },
        }));
      else if (result.bindOk && !result.searchOk)
        setBindOutcomes((previous) => ({
          ...previous,
          [key]: { ok: false, text: result.error || "Read check failed" },
        }));
      else
        setBindOutcomes((previous) => ({
          ...previous,
          [key]: { ok: false, text: result.error || "Bind failed" },
        }));
    } catch (error) {
      setBindOutcomes((previous) => ({
        ...previous,
        [key]: {
          ok: false,
          text:
            error instanceof Error ? error.message : "Bind test request failed",
        },
      }));
    } finally {
      setTestingBind(null);
    }
  };

  return {
    testingConnection,
    connectionOutcomes,
    testingBind,
    bindOutcomes,
    runConnectionTest,
    runBindTest,
  };
}
