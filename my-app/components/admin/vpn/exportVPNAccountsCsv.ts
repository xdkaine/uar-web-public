import type { VPNAccount } from "./vpnManagementTypes";

export function exportVPNAccountsCsv(filteredAndSortedAccounts: VPNAccount[]) {
  const headers = [
    "Username",
    "Name",
    "Email",
    "Portal Type",
    "Status",
    "Created",
    "Created By",
    "Expires",
    "Faculty Approved",
  ];
  const csvData = filteredAndSortedAccounts.map((acc: VPNAccount) => [
    acc.username,
    acc.name,
    acc.email || "",
    acc.portalType,
    acc.status,
    new Date(acc.createdAt).toLocaleDateString(),
    acc.createdBy,
    acc.expiresAt ? new Date(acc.expiresAt).toLocaleDateString() : "N/A",
    acc.createdByFaculty ? "Yes" : "No",
  ]);

  const csvContent = [
    headers.join(","),
    ...csvData.map((row: string[]) =>
      row
        .map((cell: string) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(","),
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute(
    "download",
    `vpn_accounts_${new Date().toISOString().split("T")[0]}.csv`,
  );
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
