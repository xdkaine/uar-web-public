'use client';

import DateTimePicker from '@/components/DateTimePicker';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  formData: {
    name: string;
    description: string;
    endDate: string; // ISO datetime string (YYYY-MM-DDTHH:mm) or empty
    isActive: boolean;
  };
  setFormData: (data: { name: string; description: string; endDate: string; isActive: boolean }) => void;
  isEditing: boolean;
}

export default function EventModal({ isOpen, onClose, onSave, formData, setFormData, isEditing }: EventModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Event' : 'Create New Event'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          <div>
            <h4 className="text-sm font-medium text-gray-500 mb-4 uppercase tracking-wider">Event Information</h4>
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="name">
                  Event Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Cybersecurity Workshop 2024"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="resize-none"
                  rows={4}
                  placeholder="Optional description of the event"
                />
              </div>

              <div className="grid gap-2">
                <DateTimePicker
                  label="Event End Date & Time"
                  value={formData.endDate}
                  onChange={(date) => setFormData({ ...formData, endDate: date })}
                  placeholder="Optional: When this event expires"
                  required={false}
                />
                <p className="text-[0.8rem] text-muted-foreground">
                  Optional: When this event expires (shown to users during request)
                </p>
              </div>

              <div className="flex items-center space-x-2 bg-gray-50 p-4 rounded-lg border border-gray-100">
                <Checkbox
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked as boolean })}
                />
                <Label htmlFor="isActive" className="cursor-pointer font-medium">
                  Active (visible to users when requesting access)
                </Label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!formData.name.trim()}>
            {isEditing ? 'Update Event' : 'Create Event'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
