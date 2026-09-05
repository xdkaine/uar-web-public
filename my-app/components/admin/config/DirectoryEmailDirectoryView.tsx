import { useMemo, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  KeyRound,
  Loader2,
  Network,
  PlugZap,
  Server,
  ServerCog,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConfigEntry } from "./config-types";
import DirectoryEmailField from "./DirectoryEmailField";
import DirectoryEmailScopesView from "./DirectoryEmailScopesView";
import {
  FAILOVER_URLS_KEY,
  PRIMARY_URL_KEY,
  parseUrlList,
  type TestOutcome,
} from "./directory-panel-shared";
import { OutcomeLine } from "./DirectoryEmailFieldShell";

type DirectoryEmailDirectoryViewProps = {
  entries: ConfigEntry[];
  drafts: Record<string, string>;
  adminGroupDns: string[];
  connectionOutcomes: Record<string, TestOutcome>;
  bindOutcomes: Record<string, TestOutcome>;
  testingConnection: string | null;
  testingBind: string | null;
  onDraftChange: (key: string, value: string) => void;
  onAdminGroupDnsChange: (value: string[]) => void;
  onConnectionTest: (url: string) => void;
  onBindTest: (url?: string) => void;
};

type ConnectionOrderProps = Pick<
  DirectoryEmailDirectoryViewProps,
  "connectionOutcomes" | "testingConnection" | "onConnectionTest"
> & {
  primary: string;
  failovers: string[];
  sourceFor: (key: string) => string;
  onMove: (index: number, direction: -1 | 1) => void;
};

function failoverRowKey(url: string, previousUrls: string[]) {
  return `${url}-${previousUrls.filter((previousUrl) => previousUrl === url).length}`;
}

function ConnectionOrder({
  primary,
  failovers,
  connectionOutcomes,
  testingConnection,
  sourceFor,
  onConnectionTest,
  onMove,
}: ConnectionOrderProps) {
  const rows = [
    { url: primary, role: "Primary", key: PRIMARY_URL_KEY },
    ...failovers.map((url, index) => ({
      url,
      role: `Failover ${index + 1}`,
      key: FAILOVER_URLS_KEY,
    })),
  ];

  return (
    <div
      className="overflow-hidden rounded-lg border"
      aria-label="Directory connection order"
    >
      <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid-cols-[42px_110px_minmax(0,1fr)_120px_150px_auto]">
        <span>Order</span>
        <span className="hidden sm:block">Role</span>
        <span>Endpoint</span>
        <span className="hidden sm:block">Source</span>
        <span className="hidden sm:block">Latest test</span>
        <span className="sr-only">Actions</span>
      </div>
      {rows.map((row, index) => {
        const outcome = connectionOutcomes[row.url];
        return (
          <div
            key={`${row.role}-${row.url}`}
            className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-3 border-b px-3 py-3 last:border-b-0 sm:grid-cols-[42px_110px_minmax(0,1fr)_120px_150px_auto]"
          >
            <span className="font-mono text-sm text-muted-foreground">
              {index + 1}
            </span>
            <strong className="hidden text-sm sm:block">{row.role}</strong>
            <span className="truncate font-mono text-xs" title={row.url}>
              {row.url || "Not configured"}
            </span>
            <Badge variant="outline" className="hidden w-fit sm:inline-flex">
              {sourceFor(row.key)}
            </Badge>
            <span
              className={cn(
                "hidden truncate text-xs sm:block",
                outcome?.ok === true && "text-teal-700 dark:text-teal-400",
                outcome?.ok === false && "text-red-700 dark:text-red-400",
              )}
            >
              {outcome ? outcome.text : "Not tested"}
            </span>
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={!row.url || testingConnection !== null}
                onClick={() => onConnectionTest(row.url)}
              >
                {testingConnection === row.url ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlugZap className="h-4 w-4" />
                )}
                <span className="hidden lg:inline">Test</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  document.getElementById(`cfg-${row.key}`)?.focus()
                }
              >
                Edit
              </Button>
              {index > 1 && (
                <>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Move failover up"
                    onClick={() => onMove(index - 1, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Move failover down"
                    disabled={index === rows.length - 1}
                    onClick={() => onMove(index - 1, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {failovers.length === 0 && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          No failover controller is configured.
        </p>
      )}
    </div>
  );
}

export default function DirectoryEmailDirectoryView({
  entries,
  drafts,
  adminGroupDns,
  connectionOutcomes,
  bindOutcomes,
  testingConnection,
  testingBind,
  onDraftChange,
  onAdminGroupDnsChange,
  onConnectionTest,
  onBindTest,
}: DirectoryEmailDirectoryViewProps) {
  const entryFor = (key: string) => entries.find((entry) => entry.key === key);
  const primaryUrlDraft = drafts[PRIMARY_URL_KEY] ?? "";
  const secondaryUrls = useMemo(
    () => parseUrlList(drafts[FAILOVER_URLS_KEY] ?? ""),
    [drafts],
  );
  const sourceFor = (key: string) => {
    const source = entryFor(key)?.source;
    return source === "database"
      ? "Saved here"
      : source === "environment"
        ? "Environment"
        : "Default";
  };
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
    <>
      <Card
        id="directory-connection"
        className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" /> Directory connection
          </CardTitle>
          <CardDescription>
            How the portal reaches Active Directory: one authoritative server,
            optional failover servers, and the service account used to read the
            directory.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ConnectionOrder
            primary={primaryUrlDraft.trim()}
            failovers={secondaryUrls}
            connectionOutcomes={connectionOutcomes}
            testingConnection={testingConnection}
            sourceFor={sourceFor}
            onConnectionTest={onConnectionTest}
            onMove={(index, direction) => {
              const target = index + direction;
              if (target < 0 || target >= secondaryUrls.length) return;
              const reordered = [...secondaryUrls];
              [reordered[index], reordered[target]] = [
                reordered[target]!,
                reordered[index]!,
              ];
              onDraftChange(FAILOVER_URLS_KEY, reordered.join(", "));
            }}
          />
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">Primary AD</p>
                <Badge>authoritative</Badge>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!primaryUrlDraft.trim() || testingConnection !== null}
                onClick={() => onConnectionTest(primaryUrlDraft.trim())}
              >
                {testingConnection === primaryUrlDraft.trim() ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <PlugZap className="h-4 w-4 mr-2" />
                )}
                Test connection
              </Button>
            </div>
            {field(
              PRIMARY_URL_KEY,
              "Server URL",
              undefined,
              "The main domain controller the portal contacts first for sign-ins and directory lookups.",
            )}
            {primaryUrlDraft.trim() &&
              connectionOutcomes[primaryUrlDraft.trim()] && (
                <OutcomeLine
                  outcome={connectionOutcomes[primaryUrlDraft.trim()]}
                />
              )}
          </div>
          <div className="rounded-lg border border-dashed p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ServerCog className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Secondary AD (failover)</p>
                <Badge variant="secondary">
                  {secondaryUrls.length} configured
                </Badge>
              </div>
            </div>
            {field(
              FAILOVER_URLS_KEY,
              "Failover URLs",
              undefined,
              "Backup domain controllers tried in order whenever the primary cannot be reached.",
            )}
            {secondaryUrls.length > 0 && (
              <ul className="space-y-2">
                {secondaryUrls.map((url, index) => (
                  <li
                    key={failoverRowKey(url, secondaryUrls.slice(0, index))}
                    className="space-y-2 rounded border bg-muted/20 px-2 py-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="shrink-0">
                        #{index + 1}
                      </Badge>
                      <span className="font-mono text-xs break-all flex-1 min-w-[12rem]">
                        {url}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={testingConnection !== null}
                        onClick={() => onConnectionTest(url)}
                      >
                        {testingConnection === url ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <PlugZap className="h-4 w-4" />
                        )}
                        Connection
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={testingBind !== null}
                        onClick={() => onBindTest(url)}
                      >
                        {testingBind === url ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <KeyRound className="h-4 w-4" />
                        )}
                        Bind
                      </Button>
                    </div>
                    {connectionOutcomes[url] && (
                      <OutcomeLine outcome={connectionOutcomes[url]} />
                    )}
                    {bindOutcomes[url] && (
                      <OutcomeLine outcome={bindOutcomes[url]} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border bg-muted/10 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">Bind account</p>
                <Badge variant="secondary">service credential</Badge>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testingBind !== null}
                onClick={() => onBindTest()}
                title="Bind with the saved account against the primary server and read the search base"
              >
                {testingBind === "(primary)" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <PlugZap className="h-4 w-4 mr-2" />
                )}
                Test bind on primary
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {field(
                "ldap.bindDn",
                "Account DN",
                undefined,
                "The service account the portal uses to read the directory — its full distinguished name.",
              )}
              {field(
                "ldap.bindPassword",
                "Password",
                undefined,
                "Password for the bind account. Stored encrypted and never shown again after saving.",
              )}
            </div>
            {field(
              "ldap.domain",
              "Domain (UPN suffix)",
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />,
              "Your Active Directory domain — combined with usernames to build user principal names during sign-in.",
            )}
            {bindOutcomes["(primary)"] && (
              <OutcomeLine outcome={bindOutcomes["(primary)"]} />
            )}
          </div>
        </CardContent>
      </Card>
      <DirectoryEmailScopesView renderField={field} />
    </>
  );
}
