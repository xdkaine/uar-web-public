"use client";

import type { FormEvent } from "react";
import { DestructiveConfirmationDialog } from "./DestructiveConfirmationDialog";
import type { BlockedEmailFormData } from "./blocklistTypes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  showAddModal: boolean;
  showEditModal: boolean;
  showDeleteConfirm: boolean;
  formData: BlockedEmailFormData;
  onFormDataChange: (formData: BlockedEmailFormData) => void;
  onAddOpenChange: (open: boolean) => void;
  onEditOpenChange: (open: boolean) => void;
  onDeleteOpenChange: (open: boolean) => void;
  onAdd: (event: FormEvent) => void;
  onUpdate: (event: FormEvent) => void;
  onDelete: () => void;
}

export function BlocklistEditorDialogs(props: Props) {
  return (
    <>
      <AddBlockDialog {...props} />
      <EditBlockDialog {...props} />
      <DestructiveConfirmationDialog
        open={props.showDeleteConfirm}
        onOpenChange={props.onDeleteOpenChange}
        title="Delete Block?"
        description="Are you sure you want to permanently delete this block? This action cannot be undone."
        onConfirm={props.onDelete}
      />
    </>
  );
}

function AddBlockDialog({
  showAddModal,
  formData,
  onFormDataChange,
  onAddOpenChange,
  onAdd,
}: Props) {
  return (
    <Dialog open={showAddModal} onOpenChange={onAddOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block Email Address</DialogTitle>
        </DialogHeader>
        <form onSubmit={onAdd} className="space-y-4">
          <AddBlockFields
            formData={formData}
            onFormDataChange={onFormDataChange}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onAddOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive">
              Block Email
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditBlockDialog({
  showEditModal,
  formData,
  onFormDataChange,
  onEditOpenChange,
  onUpdate,
}: Props) {
  return (
    <Dialog open={showEditModal} onOpenChange={onEditOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Blocked Email</DialogTitle>
        </DialogHeader>
        <form onSubmit={onUpdate} className="space-y-4">
          <EditBlockFields
            formData={formData}
            onFormDataChange={onFormDataChange}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onEditOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Update Block</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddBlockFields({
  formData,
  onFormDataChange,
}: Pick<Props, "formData" | "onFormDataChange">) {
  const updateField = (field: keyof BlockedEmailFormData, value: string) =>
    onFormDataChange({ ...formData, [field]: value });
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="email">
          Email Address <span className="text-red-500">*</span>
        </Label>
        <Input
          id="email"
          type="email"
          required
          value={formData.email}
          onChange={(event) => updateField("email", event.target.value)}
          placeholder="user@example.com"
        />
      </div>
      <CommonBlockFields
        formData={formData}
        onFormDataChange={onFormDataChange}
        prefix=""
      />
    </>
  );
}

function EditBlockFields({
  formData,
  onFormDataChange,
}: Pick<Props, "formData" | "onFormDataChange">) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="edit-email">Email Address</Label>
        <Input
          id="edit-email"
          type="email"
          disabled
          value={formData.email}
          className="bg-muted"
        />
        <p className="text-xs text-muted-foreground">Email cannot be changed</p>
      </div>
      <CommonBlockFields
        formData={formData}
        onFormDataChange={onFormDataChange}
        prefix="edit-"
      />
    </>
  );
}

function CommonBlockFields({
  formData,
  onFormDataChange,
  prefix,
}: Pick<Props, "formData" | "onFormDataChange"> & { prefix: string }) {
  const updateField = (field: keyof BlockedEmailFormData, value: string) =>
    onFormDataChange({ ...formData, [field]: value });
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}reason`}>
          Reason <span className="text-red-500">*</span>
        </Label>
        <Input
          id={`${prefix}reason`}
          type="text"
          required
          value={formData.reason}
          onChange={(event) => updateField("reason", event.target.value)}
          placeholder={prefix ? undefined : "Brief reason for blocking"}
          maxLength={500}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}notes`}>Additional Notes</Label>
        <Textarea
          id={`${prefix}notes`}
          value={formData.notes}
          onChange={(event) => updateField("notes", event.target.value)}
          placeholder={prefix ? undefined : "Additional details..."}
          rows={3}
          maxLength={2000}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}ticketId`}>Linked Support Ticket ID</Label>
        <Input
          id={`${prefix}ticketId`}
          type="text"
          value={formData.linkedTicketId}
          onChange={(event) =>
            updateField("linkedTicketId", event.target.value)
          }
          placeholder={prefix ? undefined : "Optional ticket ID"}
        />
      </div>
    </>
  );
}
