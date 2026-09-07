"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchWithCsrf } from "@/lib/csrf";

export function BatchAccountExportButton({ batchId, status }: { batchId: string; status: string }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  if (!["completed", "failed"].includes(status)) return null;

  const download = async () => {
    if (downloading) return;
    setError("");
    setDownloading(true);
    try {
      const response = await fetchWithCsrf(`/api/admin/batch-accounts/${encodeURIComponent(batchId)}/export`, {
        method: "POST",
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not download batch accounts");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `batch-accounts-${batchId.replace(/[^a-zA-Z0-9_-]/g, "_")}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not download batch accounts");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" disabled={downloading} onClick={download}>
        <Download /> {downloading ? "Downloading…" : "Download Excel with passwords"}
      </Button>
      <p className="max-w-sm text-xs text-muted-foreground">
        Contains initial passwords while retained (up to 7 days). Store securely; passwords may have changed since creation.
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
