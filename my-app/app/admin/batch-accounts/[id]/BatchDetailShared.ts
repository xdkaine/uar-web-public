import { createElement } from "react";

import { ClientLocalDate } from "@/components/admin/ClientLocalDate";
import type { StatusTone } from "@/components/ui/status-badge";

export function words(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function statusTone(status: string): StatusTone {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "reconciliation_required") return "critical";
  if (["processing", "pending"].includes(status)) return "info";
  if (["partial", "rolled_back"].includes(status)) return "warning";
  return "neutral";
}

export function batchLocalDate(
  value: string | null | undefined,
  fallback = "Not recorded",
) {
  if (!value || Number.isNaN(new Date(value).valueOf())) return fallback;
  return createElement(ClientLocalDate, { value });
}

export function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    batch_created: "Batch started",
    batch_completed: "Batch completed",
    ad_account_created: "AD account created",
    ad_account_failed: "AD account failed",
    ldap_account_created: "AD account created",
    ldap_account_failed: "AD account failed",
    vpn_account_created: "VPN account created",
    vpn_account_failed: "VPN account failed",
    account_processing_failed: "Account processing failed",
    batch_rollback_completed: "Rollback completed",
    batch_rollback_partial: "Rollback needs reconciliation",
  };
  return labels[action] ?? words(action);
}
