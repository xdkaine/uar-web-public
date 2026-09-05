"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchWithCsrf } from "@/lib/csrf";
import type { ConfigEntry } from "./config-types";
import {
  FAILOVER_URLS_KEY,
  PRIMARY_URL_KEY,
  formatValue,
  type TestOutcome,
} from "./directory-panel-shared";
import DirectoryEmailDirectoryView from "./DirectoryEmailDirectoryView";
import DirectoryEmailOverviewSaveView, {
  DirectoryEmailSaveView,
} from "./DirectoryEmailOverviewSaveView";
import DirectoryEmailRelayView from "./DirectoryEmailRelayView";
import { useDirectoryConnectionTests } from "./useDirectoryConnectionTests";

const MANAGED_KEYS = [
  PRIMARY_URL_KEY,
  FAILOVER_URLS_KEY,
  "ldap.searchBase",
  "ldap.groupSearchBase",
  "ldap.bindDn",
  "ldap.bindPassword",
  "ldap.domain",
  "ldap.adminGroups",
  "ldap.kaminoInternalGroup",
  "ldap.kaminoExternalGroup",
  "ldap.group2Add",
  "smtp.host",
  "smtp.port",
  "smtp.user",
  "smtp.password",
  "email.from",
  "email.admin",
  "email.faculty",
  "email.studentDirectors",
];

export default function DirectoryEmailPanel() {
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [adminGroupDns, setAdminGroupDns] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const {
    testingConnection,
    connectionOutcomes,
    testingBind,
    bindOutcomes,
    runConnectionTest,
    runBindTest,
  } = useDirectoryConnectionTests();
  const [testRecipient, setTestRecipient] = useState("");
  const [testingRelay, setTestingRelay] = useState(false);
  const [relayResult, setRelayResult] = useState<TestOutcome | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/config/directory-email");
      if (!response.ok) throw new Error("Failed to load configuration");
      const data = await response.json();
      const loadedEntries = (data.config || []) as ConfigEntry[];
      setEntries(loadedEntries);
      setDrafts(
        Object.fromEntries(
          loadedEntries.map((entry) => [entry.key, formatValue(entry)]),
        ),
      );
      const adminGroups = loadedEntries.find(
        (entry) => entry.key === "ldap.adminGroups",
      )?.value;
      setAdminGroupDns(
        Array.isArray(adminGroups)
          ? adminGroups.map(String)
          : adminGroups
            ? [String(adminGroups)]
            : [],
      );
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);
  const setDraft = (key: string, value: string) =>
    setDrafts((previous) => ({ ...previous, [key]: value }));

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const values: Record<string, unknown> = {};
      for (const entry of entries) {
        if (entry.key === "ldap.adminGroups") {
          const saved = Array.isArray(entry.value)
            ? entry.value.map(String)
            : entry.value
              ? [String(entry.value)]
              : [];
          if (
            JSON.stringify(adminGroupDns) !== JSON.stringify(saved)
            || (entry.source === "environment" && adminGroupDns.length > 0)
          )
            values[entry.key] = adminGroupDns.length > 0 ? adminGroupDns : null;
          continue;
        }
        const draft = drafts[entry.key] ?? "";
        if (
          draft !== formatValue(entry)
          || (!entry.secret && entry.source === "environment" && draft.trim().length > 0)
        ) values[entry.key] = draft;
      }
      if (Object.keys(values).length === 0) {
        setMessage({ type: "success", text: "No changes to save." });
        return;
      }
      const response = await fetchWithCsrf(
        "/api/admin/config/directory-email",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values, reason: reason.trim() || undefined }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to save");
      setMessage({
        type: "success",
        text: `Saved ${result.updated.length} key(s). Takes effect immediately.`,
      });
      setReason("");
      await fetchConfig();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  };

  const sendRelayTest = async () => {
    setTestingRelay(true);
    setRelayResult(null);
    try {
      const response = await fetchWithCsrf(
        "/api/admin/config/directory/test-email",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: testRecipient.trim() }),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.ok)
        setRelayResult({ ok: false, text: data.error || "Relay test failed" });
      else
        setRelayResult({
          ok: true,
          text: `Test message accepted by relay (${data.messageId}).`,
        });
    } catch (error) {
      setRelayResult({
        ok: false,
        text: error instanceof Error ? error.message : "Relay test failed",
      });
    } finally {
      setTestingRelay(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );

  const hasChanges = entries.some((entry) => {
    if (entry.key === "ldap.adminGroups") {
      const saved = Array.isArray(entry.value)
        ? entry.value.map(String)
        : entry.value
          ? [String(entry.value)]
          : [];
      return JSON.stringify(adminGroupDns) !== JSON.stringify(saved)
        || (entry.source === "environment" && adminGroupDns.length > 0);
    }
    const draft = drafts[entry.key] ?? "";
    return draft !== formatValue(entry)
      || (!entry.secret && entry.source === "environment" && draft.trim().length > 0);
  });
  const managedEntries = entries.filter((entry) =>
    MANAGED_KEYS.includes(entry.key),
  );
  const savedHereCount = managedEntries.filter(
    (entry) => entry.source === "database",
  ).length;
  const environmentCount = managedEntries.filter(
    (entry) => entry.source === "environment",
  ).length;
  const defaultsCount = Math.max(
    managedEntries.length - savedHereCount - environmentCount,
    0,
  );
  const legacyFallbackKeys: string[] = [];
  for (const entry of managedEntries)
    if (!entry.secret && entry.source === "environment")
      legacyFallbackKeys.push(entry.key);

  return (
    <div className="space-y-4">
      <DirectoryEmailOverviewSaveView
        savedHereCount={savedHereCount}
        environmentCount={environmentCount}
        defaultsCount={defaultsCount}
        legacyFallbackKeys={legacyFallbackKeys}
        message={message}
      />
      <DirectoryEmailDirectoryView
        entries={entries}
        drafts={drafts}
        adminGroupDns={adminGroupDns}
        connectionOutcomes={connectionOutcomes}
        bindOutcomes={bindOutcomes}
        testingConnection={testingConnection}
        testingBind={testingBind}
        onDraftChange={setDraft}
        onAdminGroupDnsChange={setAdminGroupDns}
        onConnectionTest={runConnectionTest}
        onBindTest={runBindTest}
      />
      <DirectoryEmailRelayView
        entries={entries}
        drafts={drafts}
        adminGroupDns={adminGroupDns}
        testRecipient={testRecipient}
        testingRelay={testingRelay}
        relayResult={relayResult}
        onDraftChange={setDraft}
        onAdminGroupDnsChange={setAdminGroupDns}
        onTestRecipientChange={setTestRecipient}
        onRelayTest={sendRelayTest}
      />
      <DirectoryEmailSaveView
        reason={reason}
        hasChanges={hasChanges}
        saving={saving}
        onReasonChange={setReason}
        onSave={save}
      />
    </div>
  );
}
