"use client";
import { Loader2, Plus, Search, UserRound, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ClientLocalDate } from "./ClientLocalDate";
import { suggestionKey } from "./ticketAccessTypes";
import type { useTicketAccessState } from "./useTicketAccessState";
type Props = ReturnType<typeof useTicketAccessState> & {
  ticketId: string;
  requesterName?: string;
  requesterUsername?: string;
};
export function TicketAccessWorkspace({
  ticketId,
  requesterName,
  requesterUsername,
  canManageAccess,
  loading,
  working,
  error,
  activeAssignments,
  history,
  query,
  setQuery,
  selected,
  setSelected,
  searchOpen,
  setSearchOpen,
  searching,
  directoryUnavailable,
  availableSuggestions,
  highlightedIndex,
  setHighlightedIndex,
  applyChange,
  chooseSuggestion,
  grantSelected,
  handleSearchKeyDown,
}: Props) {
  if (canManageAccess !== true) return null;
  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Owners</h3>
          <p className="text-xs text-muted-foreground">
            The requester and support staff own every ticket. Add approved
            people or groups for ticket access and notifications.
          </p>
        </div>
        <Badge variant="outline">{activeAssignments.length + 2} owners</Badge>
      </div>
      {error && (
        <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading ? (
        <div className="flex gap-2 py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading ticket access…
        </div>
      ) : (
        <div className="space-y-4">
          <Owners
            requesterName={requesterName}
            requesterUsername={requesterUsername}
            assignments={activeAssignments}
            working={working}
            onUnassign={(target) => void applyChange("unassign", [target])}
          />
          <SearchAccess
            ticketId={ticketId}
            query={query}
            selected={selected}
            searching={searching}
            working={working}
            searchOpen={searchOpen}
            directoryUnavailable={directoryUnavailable}
            suggestions={availableSuggestions}
            highlightedIndex={highlightedIndex}
            onQuery={(value) => {
              setQuery(value);
              setSelected(null);
              setSearchOpen(true);
            }}
            onFocus={() =>
              !selected && query.trim().length >= 3 && setSearchOpen(true)
            }
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
            onKeyDown={handleSearchKeyDown}
            onChoose={chooseSuggestion}
            onHighlight={setHighlightedIndex}
            onGrant={() => void grantSelected()}
          />
          <History entries={history} />
        </div>
      )}
    </div>
  );
}
function Owners({
  requesterName,
  requesterUsername,
  assignments,
  working,
  onUnassign,
}: {
  requesterName?: string;
  requesterUsername?: string;
  assignments: Props["activeAssignments"];
  working: boolean;
  onUnassign: (target: object) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="rounded-full border px-3 py-1 text-sm">
        Requester: {requesterName || requesterUsername || "Ticket requester"}
      </span>
      <span className="rounded-full border px-3 py-1 text-sm">
        Staff group: Support staff
      </span>
      {assignments.map((assignment) => (
        <span
          key={assignment.id}
          className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
        >
          <Badge variant="outline">
            {assignment.targetType === "directory_group" ? "Group" : "Person"}
          </Badge>
          {assignment.targetLabel}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={working}
            onClick={() =>
              onUnassign(
                assignment.targetType === "directory_group"
                  ? {
                      targetType: "directory_group",
                      dn: assignment.targetGroupDn,
                    }
                  : { targetType: "user", username: assignment.targetUsername },
              )
            }
            aria-label={`Remove ${assignment.targetLabel}'s ticket access`}
          >
            ×
          </Button>
        </span>
      ))}
    </div>
  );
}
function SearchAccess({
  ticketId,
  query,
  selected,
  searching,
  working,
  searchOpen,
  directoryUnavailable,
  suggestions,
  highlightedIndex,
  onQuery,
  onFocus,
  onBlur,
  onKeyDown,
  onChoose,
  onHighlight,
  onGrant,
}: {
  ticketId: string;
  query: string;
  selected: Props["selected"];
  searching: boolean;
  working: boolean;
  searchOpen: boolean;
  directoryUnavailable: boolean;
  suggestions: Props["availableSuggestions"];
  highlightedIndex: number;
  onQuery: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: Props["handleSearchKeyDown"];
  onChoose: Props["chooseSuggestion"];
  onHighlight: (index: number) => void;
  onGrant: () => void;
}) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={`ticket-access-search-${ticketId}`}
        className="text-xs font-medium text-muted-foreground"
      >
        Find a person or approved group
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4" />
          <Input
            id={`ticket-access-search-${ticketId}`}
            role="combobox"
            aria-expanded={searchOpen}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            className="pl-9"
            placeholder="Type a name, username, or group…"
          />
          {searchOpen && !selected && query.trim().length >= 3 && (
            <div
              role="listbox"
              className="absolute z-40 mt-1 w-full rounded border bg-popover p-1 shadow-lg"
            >
              {searching ? (
                <p className="p-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </p>
              ) : (
                suggestions.map((suggestion, index) => (
                  <button
                    key={suggestionKey(suggestion)}
                    type="button"
                    role="option"
                    aria-selected={index === highlightedIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onChoose(suggestion)}
                    onMouseEnter={() => onHighlight(index)}
                    className={cn(
                      "flex w-full gap-2 p-2 text-left",
                      index === highlightedIndex && "bg-accent",
                    )}
                  >
                    {suggestion.targetType === "user" ? (
                      <UserRound className="h-4 w-4" />
                    ) : (
                      <UsersRound className="h-4 w-4" />
                    )}
                    <span>
                      {suggestion.label}
                      <small className="block">
                        {suggestion.secondaryLabel}
                      </small>
                    </span>
                  </button>
                ))
              )}
              {directoryUnavailable && (
                <p className="border-t p-2 text-xs">
                  People search is unavailable; approved group matches are still
                  shown.
                </p>
              )}
            </div>
          )}
        </div>
        <Button type="button" disabled={working || !selected} onClick={onGrant}>
          <Plus className="h-4 w-4" />
          Add to ticket
        </Button>
      </div>
      {selected && (
        <p className="text-xs">
          Ready to add {selected.label} · {selected.secondaryLabel}
        </p>
      )}
      {!selected && query.trim().length < 3 && (
        <p className="text-xs text-muted-foreground">
          Type at least three characters. No complete directory list is loaded.
        </p>
      )}
    </div>
  );
}
function History({ entries }: { entries: Props["history"] }) {
  if (!entries.length) return null;
  return (
    <details>
      <summary>Access history</summary>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            {entry.actorUsername}{" "}
            {entry.action === "assign"
              ? "granted access to"
              : "removed access from"}{" "}
            {entry.targetLabel}
            {" · "}
            <ClientLocalDate value={entry.createdAt} />
          </li>
        ))}
      </ul>
    </details>
  );
}
