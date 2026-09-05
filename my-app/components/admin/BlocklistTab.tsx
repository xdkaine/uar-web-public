import { useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import { fetchWithCsrf } from "@/lib/csrf";
import { fetchJson } from "@/lib/client-query";
import { useToast } from "@/hooks/useToast";
import { BlocklistEditorDialogs } from "./BlocklistEditorDialogs";
import { BlocklistWorkspace } from "./BlocklistWorkspace";
import type {
  BlockedEmail,
  BlockedEmailFormData,
  BlocklistFilterStatus,
} from "./blocklistTypes";

export default function BlocklistTab() {
  const [blockedEmails, setBlockedEmails] = useState<BlockedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const selectedBlockRef = useRef<BlockedEmail | null>(null);
  const [filterStatus, setFilterStatus] =
    useState<BlocklistFilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [formData, setFormData] = useState<BlockedEmailFormData>({
    email: "",
    reason: "",
    notes: "",
    linkedTicketId: "",
  });

  const deactivationNotesRef = useRef("");

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const blockToDeleteRef = useRef<string | null>(null);

  const { showToast } = useToast();

  const blocklistParams = new URLSearchParams();
  if (filterStatus !== "active") blocklistParams.set("includeInactive", "true");
  if (debouncedSearchQuery) blocklistParams.set("search", debouncedSearchQuery);
  const blocklistKey = `/api/admin/blocklist?${blocklistParams}`;
  useSWR<{ blockedEmails?: BlockedEmail[] }>(blocklistKey, fetchJson, {
    onSuccess: (data) => {
      setBlockedEmails(data.blockedEmails || []);
      setLoading(false);
    },
    onError: () => setLoading(false),
    keepPreviousData: true,
  });

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Debounced search handler
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchQuery(value);
    }, 300);
  }, []);

  const fetchBlockedEmails = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterStatus !== "active") params.append("includeInactive", "true");
      if (debouncedSearchQuery) params.append("search", debouncedSearchQuery);

      const response = await fetch(`/api/admin/blocklist?${params}`);
      if (!response.ok) throw new Error("Failed to fetch blocked emails");
      const data = await response.json();
      setBlockedEmails(data.blockedEmails);
    } catch (error) {
      console.error("Error fetching blocked emails:", error);
      showToast("Failed to load blocked emails", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleAddBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetchWithCsrf("/api/admin/blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          reason: formData.reason,
          notes: formData.notes || null,
          linkedTicketId: formData.linkedTicketId || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to block email");
      }

      showToast("Email blocked successfully", "success");
      setShowAddModal(false);
      setFormData({ email: "", reason: "", notes: "", linkedTicketId: "" });
      fetchBlockedEmails();
    } catch (error) {
      console.error("Error blocking email:", error);
      showToast(
        (error as { message?: string }).message || "Failed to block email",
        "error",
      );
    }
  };

  const handleUpdateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedBlock = selectedBlockRef.current;
    if (!selectedBlock) return;

    try {
      const response = await fetchWithCsrf(
        `/api/admin/blocklist/${selectedBlock.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: formData.reason,
            notes: formData.notes || null,
            linkedTicketId: formData.linkedTicketId || null,
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update block");
      }

      showToast("Block updated successfully", "success");
      setShowEditModal(false);
      selectedBlockRef.current = null;
      fetchBlockedEmails();
    } catch (error) {
      console.error("Error updating block:", error);
      showToast(
        (error as { message?: string }).message || "Failed to update block",
        "error",
      );
    }
  };

  const handleToggleActive = async (block: BlockedEmail) => {
    const newActiveState = !block.isActive;
    const notes = newActiveState ? "" : deactivationNotesRef.current;

    try {
      const response = await fetchWithCsrf(`/api/admin/blocklist/${block.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isActive: newActiveState,
          deactivationNotes: notes || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to toggle block status");
      }

      showToast(
        newActiveState ? "Email block reactivated" : "Email block deactivated",
        "success",
      );
      deactivationNotesRef.current = "";
      fetchBlockedEmails();
    } catch (error) {
      console.error("Error toggling block:", error);
      showToast(
        (error as { message?: string }).message ||
          "Failed to toggle block status",
        "error",
      );
    }
  };

  const confirmDeleteBlock = (id: string) => {
    blockToDeleteRef.current = id;
    setShowDeleteConfirm(true);
  };

  const handleDeleteBlock = async () => {
    const blockToDelete = blockToDeleteRef.current;
    if (!blockToDelete) return;

    try {
      const response = await fetchWithCsrf(
        `/api/admin/blocklist/${blockToDelete}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete block");
      }

      showToast("Block deleted successfully", "success");
      fetchBlockedEmails();
    } catch (error) {
      console.error("Error deleting block:", error);
      showToast(
        (error as { message?: string }).message || "Failed to delete block",
        "error",
      );
    } finally {
      setShowDeleteConfirm(false);
      blockToDeleteRef.current = null;
    }
  };

  const openEditModal = (block: BlockedEmail) => {
    selectedBlockRef.current = block;
    setFormData({
      email: block.email,
      reason: block.reason,
      notes: block.notes || "",
      linkedTicketId: block.linkedTicketId || "",
    });
    setShowEditModal(true);
  };

  const filteredEmails = blockedEmails.filter((block) => {
    if (filterStatus === "active") return block.isActive;
    if (filterStatus === "inactive") return !block.isActive;
    return true;
  });

  if (loading) {
    return (
      <div className="bg-card p-6 sm:p-8 rounded-lg shadow-xl border-2 border-border text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black mx-auto"></div>
        <p className="mt-4 text-muted-foreground">Loading blocked emails...</p>
      </div>
    );
  }

  return (
    <>
      <BlocklistWorkspace
        blockedEmails={blockedEmails}
        filteredEmails={filteredEmails}
        filterStatus={filterStatus}
        searchQuery={searchQuery}
        onFilterStatusChange={setFilterStatus}
        onSearchChange={handleSearchChange}
        onAdd={() => setShowAddModal(true)}
        onEdit={openEditModal}
        onToggleActive={(block) => void handleToggleActive(block)}
        onDelete={confirmDeleteBlock}
      />
      <BlocklistEditorDialogs
        showAddModal={showAddModal}
        showEditModal={showEditModal}
        showDeleteConfirm={showDeleteConfirm}
        formData={formData}
        onFormDataChange={setFormData}
        onAddOpenChange={setShowAddModal}
        onEditOpenChange={setShowEditModal}
        onDeleteOpenChange={setShowDeleteConfirm}
        onAdd={handleAddBlock}
        onUpdate={handleUpdateBlock}
        onDelete={() => void handleDeleteBlock()}
      />
    </>
  );
}
