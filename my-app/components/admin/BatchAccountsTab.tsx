"use client";

import {
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { requestActionImpact } from "@/components/admin/actionImpactRequest";
import { BATCH_OWNERSHIP_CONFIRMATION } from "@/components/admin/batchAccountConfirmation";
import DateTimePicker from "@/components/DateTimePicker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  reviewBatchAccountPlan,
  type BatchAdAccountDraft,
  type BatchVpnAccountDraft,
} from "@/lib/batch-account-plan";
import { fetchWithCsrf } from "@/lib/csrf";
import { useToast } from "@/hooks/useToast";
import { BatchHistory } from "./BatchHistory";

export interface BatchCreation {
  id: string;
  createdAt: string;
  createdBy: string;
  description: string;
  totalAccounts: number;
  successfulAccounts: number;
  failedAccounts: number;
  status: string;
  processingClaimedUntil?: string | null;
  completedAt?: string;
  linkedTicket?: { id: string; subject: string; status: string };
  accounts: Array<{
    id: string;
    name: string;
    ldapUsername: string;
    status: string;
    errorMessage?: string;
  }>;
  _count: { accounts: number; auditLogs: number };
}
interface Props {
  batches: BatchCreation[];
  supportTickets: Array<{ id: string; subject: string; status: string }>;
  onBatchCreated: () => void | Promise<void>;
}
type AdEntry = BatchAdAccountDraft & { draftKey: string };
type VpnEntry = BatchVpnAccountDraft & { draftKey: string };
type Review = ReturnType<typeof reviewBatchAccountPlan>;
type SetEntries<T> = Dispatch<SetStateAction<T[]>>;
const STEPS = ["Details", "Accounts", "Review & start"] as const;
const password = () => {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => chars[value % chars.length]).join("");
};
const stripAd = ({ draftKey, ...draft }: AdEntry) => {
  void draftKey;
  return draft;
};
const stripVpn = ({ draftKey, ...draft }: VpnEntry) => {
  void draftKey;
  return draft;
};

export default function BatchAccountsTab({
  batches,
  supportTickets,
  onBatchCreated,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [description, setDescription] = useState("");
  const [linkedTicketId, setLinkedTicketId] = useState("");
  const [adAccounts, setAdAccounts] = useState<AdEntry[]>([]);
  const [vpnAccounts, setVpnAccounts] = useState<VpnEntry[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const keyRef = useRef("");
  const submittedRef = useRef(false);
  const requested = searchParams.get("action") === "new";
  const visible = open || requested;
  const review = useMemo(
    () => reviewBatchAccountPlan(description, adAccounts, vpnAccounts),
    [description, adAccounts, vpnAccounts],
  );
  const reset = () => {
    setOpen(false);
    setStep(1);
    setDescription("");
    setLinkedTicketId("");
    setAdAccounts([]);
    setVpnAccounts([]);
    keyRef.current = "";
    submittedRef.current = false;
    if (requested) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("action");
      const query = params.toString();
      router.replace(`/admin/batch${query ? `?${query}` : ""}`, {
        scroll: false,
      });
    }
  };
  const edit = () => {
    if (submittedRef.current) {
      keyRef.current = crypto.randomUUID();
      submittedRef.current = false;
    }
  };
  const addAd = () => {
    if (adAccounts.length + vpnAccounts.length >= 100)
      return showToast("Maximum 100 total accounts per batch", "error");
    edit();
    setAdAccounts((items) => [
      ...items,
      {
        draftKey: crypto.randomUUID(),
        name: "",
        email: "",
        ldapUsername: "",
        password: "",
        accountExpiresAt: "",
        isInternal: true,
      },
    ]);
  };
  const addVpn = () => {
    if (adAccounts.length + vpnAccounts.length >= 100)
      return showToast("Maximum 100 total accounts per batch", "error");
    edit();
    setVpnAccounts((items) => [
      ...items,
      {
        draftKey: crypto.randomUUID(),
        name: "",
        email: "",
        vpnUsername: "",
        password: "",
        accountExpiresAt: "",
        portalType: "External",
      },
    ]);
  };
  const cancel = async (batch: BatchCreation) => {
    const decision = await requestActionImpact({
      title: "Cancel account batch",
      description: `Cancel "${batch.description}" and reconcile accounts it may already have created.`,
      items: [
        { label: "Scope", value: batch.description },
        {
          label: "External effects",
          value: "Created directory and VPN accounts enter reconciliation",
          tone: "warning",
        },
      ],
      confirmLabel: "Cancel and reconcile",
      destructive: true,
      evidence: "Cancellation and each reconciliation outcome are audited.",
    });
    if (!decision.confirmed) return;
    try {
      const response = await fetchWithCsrf(
        `/api/admin/batch-accounts/${batch.id}/cancel`,
        { method: "DELETE" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Batch cancellation failed");
      showToast(
        data.partial
          ? `Cancellation needs reconciliation for ${data.rollback?.failed || 0} account(s).`
          : "Batch cancelled",
        data.partial ? "warning" : "success",
      );
      await onBatchCreated();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Batch cancellation failed",
        "error",
      );
    }
  };
  const submit = async () => {
    if (!review.isReady || isSubmitting) return;
    const ticket = supportTickets.find((item) => item.id === linkedTicketId);
    const decision = await requestActionImpact({
      title: "Start reviewed account batch",
      description: BATCH_OWNERSHIP_CONFIRMATION,
      items: [
        { label: "AD accounts", value: adAccounts.length },
        { label: "VPN accounts", value: vpnAccounts.length },
        { label: "Support ticket", value: ticket?.subject || "None" },
        {
          label: "Failure handling",
          value: "Partial outcomes stop for rollback or reconciliation",
          tone: "warning",
        },
      ],
      confirmLabel: "Start batch",
      destructive: true,
      evidence:
        "The submission key prevents the same reviewed batch from starting twice.",
    });
    if (!decision.confirmed) return;
    setIsSubmitting(true);
    submittedRef.current = true;
    try {
      const response = await fetchWithCsrf("/api/admin/batch-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          linkedTicketId: linkedTicketId || undefined,
          idempotencyKey: keyRef.current,
          adAccounts: adAccounts.map(stripAd),
          vpnAccounts: vpnAccounts.map(stripVpn),
        }),
      });
      const data = await response.json();
      if (data.replayed && data.batch?.id) {
        showToast(
          "This batch was already submitted; opening the existing tracked operation.",
          "warning",
        );
        await onBatchCreated();
        router.push(`/admin/batch-accounts/${data.batch.id}`);
        return;
      }
      if (!response.ok) {
        if (data.batch?.id) {
          showToast(data.error || "Batch requires review", "warning");
          await onBatchCreated();
          router.push(`/admin/batch-accounts/${data.batch.id}`);
          return;
        }
        throw new Error(data.error || "Failed to create batch");
      }
      showToast(
        `Batch complete: ${data.summary.successful} successful, ${data.summary.failed} failed`,
        data.summary.failed > 0 ? "warning" : "success",
      );
      await onBatchCreated();
      reset();
      router.push(`/admin/batch-accounts/${data.batch.id}`);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to create batch",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Batch operations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Prepare, review, and start a tracked account batch.
          </p>
        </div>
        {!visible && (
          <Button
            onClick={() => {
              keyRef.current = crypto.randomUUID();
              submittedRef.current = false;
              setStep(1);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New batch
          </Button>
        )}
      </div>
      {visible && (
        <BatchWizard
          step={step}
          description={description}
          linkedTicketId={linkedTicketId}
          supportTickets={supportTickets}
          adAccounts={adAccounts}
          vpnAccounts={vpnAccounts}
          review={review}
          isSubmitting={isSubmitting}
          onDescription={(value) => {
            edit();
            setDescription(value);
          }}
          onTicket={(value) => {
            edit();
            setLinkedTicketId(value);
          }}
          onAdChange={setAdAccounts}
          onVpnChange={setVpnAccounts}
          onAddAd={addAd}
          onAddVpn={addVpn}
          onClose={reset}
          onStep={setStep}
          onSubmit={() => void submit()}
        />
      )}
      <BatchHistory
        batches={batches}
        onView={(id) => router.push(`/admin/batch-accounts/${id}`)}
        onCancel={(batch) => void cancel(batch)}
      />
    </div>
  );
}

function BatchWizard({
  step,
  description,
  linkedTicketId,
  supportTickets,
  adAccounts,
  vpnAccounts,
  review,
  isSubmitting,
  onDescription,
  onTicket,
  onAdChange,
  onVpnChange,
  onAddAd,
  onAddVpn,
  onClose,
  onStep,
  onSubmit,
}: {
  step: 1 | 2 | 3;
  description: string;
  linkedTicketId: string;
  supportTickets: Props["supportTickets"];
  adAccounts: AdEntry[];
  vpnAccounts: VpnEntry[];
  review: Review;
  isSubmitting: boolean;
  onDescription: (value: string) => void;
  onTicket: (value: string) => void;
  onAdChange: SetEntries<AdEntry>;
  onVpnChange: SetEntries<VpnEntry>;
  onAddAd: () => void;
  onAddVpn: () => void;
  onClose: () => void;
  onStep: (step: 1 | 2 | 3) => void;
  onSubmit: () => void;
}) {
  return (
    <Card id="new-account-batch">
      <CardHeader className="border-b">
        <div className="flex justify-between gap-4">
          <div>
            <CardTitle>New account batch</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing is provisioned until the final review is confirmed.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Close
          </Button>
        </div>
        <ol className="mt-5 grid grid-cols-3 overflow-hidden rounded-md border text-sm">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={`flex items-center gap-2 px-3 py-2.5 ${index > 0 ? "border-l" : ""} ${index + 1 === step ? "bg-muted font-medium" : ""}`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border text-xs">
                {index + 1 < step ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
      </CardHeader>
      <CardContent className="pt-6">
        {step === 1 ? (
          <BatchDetails
            description={description}
            ticket={linkedTicketId}
            tickets={supportTickets}
            onDescription={onDescription}
            onTicket={onTicket}
          />
        ) : step === 2 ? (
          <BatchAccountsEditor
            adAccounts={adAccounts}
            vpnAccounts={vpnAccounts}
            onAdChange={onAdChange}
            onVpnChange={onVpnChange}
            onAddAd={onAddAd}
            onAddVpn={onAddVpn}
          />
        ) : (
          <BatchReview
            review={review}
            description={description}
            adCount={adAccounts.length}
            vpnCount={vpnAccounts.length}
          />
        )}
        <div className="mt-6 flex justify-between border-t pt-4">
          <Button
            variant="outline"
            onClick={() =>
              step === 1 ? onClose() : onStep((step - 1) as 1 | 2 | 3)
            }
            disabled={isSubmitting}
          >
            <ArrowLeft className="h-4 w-4" />
            {step === 1 ? "Cancel" : "Back"}
          </Button>
          {step < 3 ? (
            <Button
              onClick={() => onStep((step + 1) as 1 | 2 | 3)}
              disabled={step === 1 && !description.trim()}
            >
              {step === 1 ? "Continue to accounts" : "Review batch"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={onSubmit}
              disabled={!review.isReady || isSubmitting}
            >
              {isSubmitting
                ? "Starting batch…"
                : `Start ${review.rows.length} account${review.rows.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BatchDetails({
  description,
  ticket,
  tickets,
  onDescription,
  onTicket,
}: {
  description: string;
  ticket: string;
  tickets: Props["supportTickets"];
  onDescription: (value: string) => void;
  onTicket: (value: string) => void;
}) {
  return (
    <div className="max-w-3xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="batch-description">Purpose or event</Label>
        <Input
          id="batch-description"
          value={description}
          onChange={(event) => onDescription(event.target.value)}
          placeholder="Conference attendees - September session"
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="batch-ticket">Support ticket (optional)</Label>
        <Select
          value={ticket || "none"}
          onValueChange={(value) => onTicket(value === "none" ? "" : value)}
        >
          <SelectTrigger id="batch-ticket">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No linked ticket</SelectItem>
            {tickets.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.subject} · {item.status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function BatchAccountsEditor({
  adAccounts,
  vpnAccounts,
  onAdChange,
  onVpnChange,
  onAddAd,
  onAddVpn,
}: {
  adAccounts: AdEntry[];
  vpnAccounts: VpnEntry[];
  onAdChange: SetEntries<AdEntry>;
  onVpnChange: SetEntries<VpnEntry>;
  onAddAd: () => void;
  onAddVpn: () => void;
}) {
  const update = (
    kind: "ad" | "vpn",
    index: number,
    field: string,
    value: string | boolean,
  ) =>
    (
      (kind === "ad" ? onAdChange : onVpnChange) as Dispatch<
        SetStateAction<(AdEntry | VpnEntry)[]>
      >
    )((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    );
  const remove = (kind: "ad" | "vpn", key: string) =>
    (
      (kind === "ad" ? onAdChange : onVpnChange) as Dispatch<
        SetStateAction<(AdEntry | VpnEntry)[]>
      >
    )((items) => items.filter((item) => item.draftKey !== key));
  return (
    <div className="space-y-7">
      <AccountSection
        title="AD accounts"
        accounts={adAccounts}
        kind="ad"
        onAdd={onAddAd}
        onUpdate={update}
        onRemove={remove}
      />
      <AccountSection
        title="VPN accounts"
        accounts={vpnAccounts}
        kind="vpn"
        onAdd={onAddVpn}
        onUpdate={update}
        onRemove={remove}
      />
    </div>
  );
}
function AccountSection({
  title,
  accounts,
  kind,
  onAdd,
  onUpdate,
  onRemove,
}: {
  title: string;
  accounts: (AdEntry | VpnEntry)[];
  kind: "ad" | "vpn";
  onAdd: () => void;
  onUpdate: (
    kind: "ad" | "vpn",
    index: number,
    field: string,
    value: string | boolean,
  ) => void;
  onRemove: (kind: "ad" | "vpn", key: string) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            {title}{" "}
            <span className="text-muted-foreground">({accounts.length})</span>
          </h3>
          <p className="text-xs text-muted-foreground">
            {kind === "ad"
              ? "At least one is required. External accounts require expiration."
              : "Optional. Every VPN account requires an expiration."}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-4 w-4" /> Add {kind === "ad" ? "AD" : "VPN"}{" "}
          account
        </Button>
      </div>
      {accounts.map((account, index) => (
        <AccountFields
          key={account.draftKey}
          account={account}
          index={index}
          kind={kind}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      ))}
    </section>
  );
}
function AccountFields({
  account,
  index,
  kind,
  onUpdate,
  onRemove,
}: {
  account: AdEntry | VpnEntry;
  index: number;
  kind: "ad" | "vpn";
  onUpdate: (
    kind: "ad" | "vpn",
    index: number,
    field: string,
    value: string | boolean,
  ) => void;
  onRemove: (kind: "ad" | "vpn", key: string) => void;
}) {
  const adAccount = account as AdEntry;
  const vpnAccount = account as VpnEntry;
  const set = (field: string, value: string | boolean) =>
    onUpdate(kind, index, field, value);
  const id = `${kind}-${account.draftKey}`;
  return (
    <div className="rounded-md border p-4">
      <div className="mb-3 flex justify-between">
        <span className="text-sm font-medium">
          {kind === "ad" ? "AD" : "VPN"} account {index + 1}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRemove(kind, account.draftKey)}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
          Remove
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Field
          id={`${id}-name`}
          label="Full name"
          value={account.name ?? ""}
          onChange={(value: string) => set("name", value)}
        />
        <Field
          id={`${id}-email`}
          label={kind === "ad" ? "Email" : "Email (optional)"}
          value={account.email ?? ""}
          onChange={(value: string) => set("email", value)}
          type="email"
        />
        <Field
          id={`${id}-username`}
          label={kind === "ad" ? "AD username" : "VPN username"}
          value={
            kind === "ad" ? adAccount.ldapUsername : vpnAccount.vpnUsername
          }
          onChange={(value: string) =>
            set(kind === "ad" ? "ldapUsername" : "vpnUsername", value)
          }
        />
        <Field
          id={`${id}-password`}
          label="Initial password"
          value={account.password ?? ""}
          onChange={(value: string) => set("password", value)}
          password
          onGenerate={() => set("password", password())}
        />
        {kind === "vpn" && (
          <div className="space-y-1.5">
            <Label>Portal type</Label>
            <Select
              value={vpnAccount.portalType}
              onValueChange={(value) => set("portalType", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Management">
                  Internal - Management
                </SelectItem>
                <SelectItem value="Limited">Internal - Limited</SelectItem>
                <SelectItem value="External">External</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <DateTimePicker
          label={`Expiration${kind === "ad" && adAccount.isInternal ? " (optional)" : ""}`}
          value={account.accountExpiresAt}
          onChange={(value) => set("accountExpiresAt", value)}
          required={kind === "vpn" || !adAccount.isInternal}
          placeholder="Select expiration"
        />
        {kind === "ad" && (
          <div className="flex items-center gap-2 pt-7">
            <Checkbox
              id={`${id}-internal`}
              checked={adAccount.isInternal}
              onCheckedChange={(checked) => set("isInternal", checked === true)}
            />
            <Label htmlFor={`${id}-internal`}>Internal account</Label>
          </div>
        )}
      </div>
    </div>
  );
}
function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  password: isPassword,
  onGenerate,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  password?: boolean;
  onGenerate?: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type={isPassword ? "password" : type}
          autoComplete={isPassword ? "new-password" : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {isPassword && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="Generate password"
            onClick={onGenerate}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
function BatchReview({
  review,
  description,
  adCount,
  vpnCount,
}: {
  review: Review;
  description: string;
  adCount: number;
  vpnCount: number;
}) {
  return (
    <div className="space-y-4">
      <Alert className="bg-muted/20">
        <AlertTriangle />
        <AlertTitle>Final validation happens under lock</AlertTitle>
        <AlertDescription>
          The server checks active requests and directory usernames while
          holding race-control locks.
        </AlertDescription>
      </Alert>
      {review.issues.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Batch-level issues</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {review.issues.map((issue: string) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Review</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {review.rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{row.type}</TableCell>
                <TableCell>{row.name || "—"}</TableCell>
                <TableCell>{row.username || "—"}</TableCell>
                <TableCell>
                  {row.issues.length === 0 ? "Ready" : row.issues.join(", ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-3 rounded-md border bg-muted/20 p-4 text-sm sm:grid-cols-3">
        <div>
          Purpose<p className="font-medium">{description || "—"}</p>
        </div>
        <div>
          Accounts
          <p className="font-medium">
            {adCount} AD · {vpnCount} VPN
          </p>
        </div>
        <div>
          Tracking
          <p className="font-medium">
            One batch ID + one request ID per AD account
          </p>
        </div>
      </div>
    </div>
  );
}
