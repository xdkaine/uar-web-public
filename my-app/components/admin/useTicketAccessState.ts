"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { fetchWithCsrf } from "@/lib/csrf";
import {
  assignmentKey,
  suggestionKey,
  type AssignmentSuggestion,
  type TicketAssignment,
  type TicketAssignmentHistoryEntry,
} from "./ticketAccessTypes";

export function useTicketAccessState(ticketId: string) {
  const [assignments, setAssignments] = useState<TicketAssignment[]>([]);
  const [history, setHistory] = useState<TicketAssignmentHistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AssignmentSuggestion[]>([]);
  const [selected, setSelected] = useState<AssignmentSuggestion | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [directoryUnavailable, setDirectoryUnavailable] = useState(false);
  const [canManageAccess, setCanManageAccess] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadState = useCallback(async () => {
    setError(null);
    try {
      const sessionResponse = await fetch("/api/auth/session");
      if (!sessionResponse.ok)
        throw new Error("Failed to verify ticket access permission");
      const session = await sessionResponse.json();
      const allowed =
        Array.isArray(session.permissions) &&
        session.permissions.includes("tickets.assign");
      setCanManageAccess(allowed);
      if (!allowed) return;
      const response = await fetch(
        `/api/admin/support/tickets/${ticketId}/assignments`,
      );
      if (response.ok) {
        const result = await response.json();
        setAssignments(result.assignments ?? []);
        setHistory(result.history ?? []);
      } else if (response.status !== 403)
        throw new Error("Failed to load ticket access");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load ticket access",
      );
    } finally {
      setLoading(false);
    }
  }, [ticketId]);
  useEffect(() => {
    loadState();
  }, [loadState]);
  useEffect(() => {
    const normalizedQuery = query.trim();
    if (canManageAccess !== true || selected || normalizedQuery.length < 3) {
      setSuggestions([]);
      setSearching(false);
      setDirectoryUnavailable(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(
          `/api/admin/support/tickets/assignment-suggestions?q=${encodeURIComponent(normalizedQuery)}`,
          { signal: controller.signal },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Search failed");
        setSuggestions(result.suggestions ?? []);
        setDirectoryUnavailable(result.directoryUnavailable === true);
        setHighlightedIndex(0);
      } catch (searchError) {
        if ((searchError as Error).name !== "AbortError") {
          setSuggestions([]);
          setDirectoryUnavailable(true);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canManageAccess, query, selected]);
  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.isActive),
    [assignments],
  );
  const activeKeys = useMemo(
    () => new Set(activeAssignments.map(assignmentKey)),
    [activeAssignments],
  );
  const availableSuggestions = useMemo(
    () =>
      suggestions.filter(
        (suggestion) => !activeKeys.has(suggestionKey(suggestion)),
      ),
    [activeKeys, suggestions],
  );
  const applyChange = async (
    action: "assign" | "unassign",
    targets: unknown[],
  ) => {
    if (canManageAccess !== true) return false;
    setWorking(true);
    setError(null);
    try {
      const response = await fetchWithCsrf(
        `/api/admin/support/tickets/${ticketId}/assignments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, targets }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Failed to ${action}`);
      await loadState();
      return true;
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : `Failed to ${action}`,
      );
      return false;
    } finally {
      setWorking(false);
    }
  };
  const chooseSuggestion = (suggestion: AssignmentSuggestion) => {
    setSelected(suggestion);
    setQuery(suggestion.label);
    setSuggestions([]);
    setSearchOpen(false);
  };
  const grantSelected = async () => {
    if (!selected) return;
    const target =
      selected.targetType === "user"
        ? { targetType: "user", username: selected.username }
        : { targetType: "directory_group", dn: selected.dn };
    if (await applyChange("assign", [target])) {
      setSelected(null);
      setQuery("");
    }
  };
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!searchOpen || availableSuggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex(
        (current) => (current + 1) % availableSuggestions.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex(
        (current) =>
          (current - 1 + availableSuggestions.length) %
          availableSuggestions.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseSuggestion(availableSuggestions[highlightedIndex]);
    } else if (event.key === "Escape") setSearchOpen(false);
  };
  return {
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
  };
}
