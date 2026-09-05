import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  GraduationCap,
  KeyRound,
  Loader2,
  Mail,
  Network,
  Send,
  Server,
  ShieldCheck,
  User,
} from "lucide-react";
import type { ConfigEntry } from "./config-types";
import DirectoryEmailField from "./DirectoryEmailField";
import { formatValue, type TestOutcome } from "./directory-panel-shared";
import { FieldShell, OutcomeLine } from "./DirectoryEmailFieldShell";

type DirectoryEmailRelayViewProps = {
  entries: ConfigEntry[];
  drafts: Record<string, string>;
  adminGroupDns: string[];
  testRecipient: string;
  testingRelay: boolean;
  relayResult: TestOutcome | null;
  onDraftChange: (key: string, value: string) => void;
  onAdminGroupDnsChange: (value: string[]) => void;
  onTestRecipientChange: (value: string) => void;
  onRelayTest: () => void;
};

export default function DirectoryEmailRelayView({
  entries,
  drafts,
  adminGroupDns,
  testRecipient,
  testingRelay,
  relayResult,
  onDraftChange,
  onAdminGroupDnsChange,
  onTestRecipientChange,
  onRelayTest,
}: DirectoryEmailRelayViewProps) {
  const entryFor = (key: string) => entries.find((entry) => entry.key === key);
  const portEntry = entryFor("smtp.port");
  const portDraft = drafts["smtp.port"] ?? "";
  const field = (
    key: string,
    label: string,
    icon?: ReactNode,
    help?: ReactNode,
  ) => (
    <DirectoryEmailField
      entry={entryFor(key)}
      drafts={drafts}
      adminGroupDns={adminGroupDns}
      label={label}
      icon={icon}
      help={help}
      onDraftChange={onDraftChange}
      onAdminGroupDnsChange={onAdminGroupDnsChange}
    />
  );

  return (
    <Card
      id="directory-email-relay"
      className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" /> Email relay &amp; addresses
        </CardTitle>
        <CardDescription>
          Outbound mail connection and the addresses portal notifications use.
          Port 465 uses implicit TLS; any other port upgrades with STARTTLS.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          {field(
            "smtp.host",
            "Relay host",
            <Server className="h-3.5 w-3.5 text-muted-foreground" />,
            "The mail server that actually delivers every email the portal sends.",
          )}
          {portEntry && (
            <FieldShell
              id="cfg-smtp.port"
              label="Port"
              icon={<Network className="h-3.5 w-3.5 text-muted-foreground" />}
              entry={portEntry}
              dirty={portDraft !== formatValue(portEntry)}
              help="587 upgrades to encryption after connecting (STARTTLS); 465 encrypts from the start."
            >
              <div className="space-y-1.5">
                <Input
                  id="cfg-smtp.port"
                  inputMode="numeric"
                  className="max-w-[10rem]"
                  value={portDraft}
                  onChange={(event) =>
                    onDraftChange("smtp.port", event.target.value)
                  }
                />
                <div className="flex gap-1.5">
                  {[
                    { value: "587", hint: "STARTTLS" },
                    { value: "465", hint: "implicit TLS" },
                  ].map((preset) => (
                    <Button
                      key={preset.value}
                      type="button"
                      variant={
                        portDraft === preset.value ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => onDraftChange("smtp.port", preset.value)}
                    >
                      {preset.value} ({preset.hint})
                    </Button>
                  ))}
                </div>
              </div>
            </FieldShell>
          )}
          {field(
            "smtp.user",
            "Username",
            <User className="h-3.5 w-3.5 text-muted-foreground" />,
            "Account used to log in to the relay when it requires authentication.",
          )}
          {field(
            "smtp.password",
            "Password",
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />,
            "Password for the relay login. Stored encrypted and never shown again after saving.",
          )}
        </div>
        <div className="space-y-4 border-t pt-4">
          <div className="space-y-1">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Mail className="h-4 w-4 text-primary" /> Notification addresses
            </p>
            <p className="text-xs text-muted-foreground">Who receives what:</p>
          </div>
          {field(
            "email.from",
            "From address",
            undefined,
            "Shown as the sender on every message the portal sends — verifications, approvals, and ticket updates.",
          )}
          {field(
            "email.admin",
            "Admin mailbox",
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />,
            "Operational inbox: receives new support tickets and copies of requester replies.",
          )}
          {field(
            "email.faculty",
            "Faculty mailbox",
            <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />,
            "Reviewer inbox for pending-approval notifications — for example VPN accounts waiting on faculty approval.",
          )}
          {field(
            "email.studentDirectors",
            "Student directors",
            <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />,
            "Each address in this comma-separated list receives important event notifications about requests.",
          )}
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Test the relay</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="smtp-relay-test-recipient"
              type="email"
              className="max-w-xs"
              placeholder="you@example.org"
              value={testRecipient}
              onChange={(event) => onTestRecipientChange(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={testingRelay || !testRecipient.includes("@")}
              onClick={onRelayTest}
            >
              {testingRelay ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send test email
            </Button>
          </div>
          {relayResult && <OutcomeLine outcome={relayResult} />}
          <p className="text-xs text-muted-foreground">
            Sends a one-off message through the saved (or environment-fallback)
            relay settings. Save pending changes first so the test uses them.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
