"use client";

import { PasswordExpirationWorkspace } from "./PasswordExpirationWorkspace";
import { usePasswordExpirationReport } from "./usePasswordExpirationReport";

export default function PasswordExpirationTab() {
  return <PasswordExpirationWorkspace {...usePasswordExpirationReport()} />;
}
