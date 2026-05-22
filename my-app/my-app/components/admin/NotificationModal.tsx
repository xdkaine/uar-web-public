'use client';

import DateTimePicker from '@/components/DateTimePicker';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { 
  AlertCircle, 
  CheckCircle2, 
  Info, 
  AlertTriangle,
  X 
} from "lucide-react";

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  formData: {
    message: string;
    type: string;
    priority: number;
    isActive: boolean;
    startDate: string;
    endDate: string;
    dismissible: boolean;
  };
  setFormData: (data: {
    message: string;
    type: string;
    priority: number;
    isActive: boolean;
    startDate: string;
    endDate: string;
    dismissible: boolean;
  }) => void;
  isEditing: boolean;
  isSaving: boolean;
}

export default function NotificationModal({ 
  isOpen, 
  onClose, 
  onSave, 
  formData, 
  setFormData, 
  isEditing,
  isSaving 
}: NotificationModalProps) {
  
  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  const getTypeStyle = (type: string) => {
    switch (type) {
      case 'error': return 'bg-red-50 text-red-800 border-red-200';
      case 'warning': return 'bg-yellow-50 text-yellow-800 border-yellow-200';
      case 'success': return 'bg-green-50 text-green-800 border-green-200';
      default: return 'bg-blue-50 text-blue-800 border-blue-200';
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'error': return <AlertCircle className="w-5 h-5 text-red-600" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      case 'success': return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      default: return <Info className="w-5 h-5 text-blue-600" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Notification' : 'Create New Notification'}</DialogTitle>
          <DialogDescription>
            Configure the notification banner that users will see.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="message">Message <span className="text-red-500">*</span></Label>
            <Textarea
              id="message"
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              placeholder="Enter notification message"
              className="resize-none"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Type <span className="text-red-500">*</span></Label>
              <Select
                value={formData.type}
                onValueChange={(value) => setFormData({ ...formData, type: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info (Blue)</SelectItem>
                  <SelectItem value="warning">Warning (Yellow)</SelectItem>
                  <SelectItem value="error">Error (Red)</SelectItem>
                  <SelectItem value="success">Success (Green)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Input
                id="priority"
                type="number"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                placeholder="0"
              />
              <p className="text-[0.8rem] text-muted-foreground">Higher numbers display first</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
               <Label>Start Date</Label>
               <DateTimePicker
                  label=""
                  value={formData.startDate}
                  onChange={(datetime) => setFormData({ ...formData, startDate: datetime })}
                  placeholder="Start date..."
               />
            </div>
            <div className="space-y-2">
               <Label>End Date</Label>
               <DateTimePicker
                  label=""
                  value={formData.endDate}
                  onChange={(datetime) => setFormData({ ...formData, endDate: datetime })}
                  placeholder="End date..."
               />
            </div>
          </div>

          <div className="flex flex-row space-x-6 bg-muted/40 p-4 rounded-lg">
             <div className="flex items-center space-x-2">
                <Checkbox 
                  id="isActive" 
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked as boolean })}
                />
                <Label htmlFor="isActive" className="cursor-pointer">Active</Label>
             </div>

             <div className="flex items-center space-x-2">
                <Checkbox 
                  id="dismissible" 
                  checked={formData.dismissible}
                  onCheckedChange={(checked) => setFormData({ ...formData, dismissible: checked as boolean })}
                />
                <Label htmlFor="dismissible" className="cursor-pointer">Dismissible</Label>
             </div>
          </div>

          {formData.message && (
            <div className="space-y-2">
               <Label>Preview</Label>
               <div className={`p-4 rounded-lg border flex items-start gap-3 ${getTypeStyle(formData.type)}`}>
                  {getIcon(formData.type)}
                  <div className="flex-1 text-sm font-medium pt-0.5">
                     {formData.message}
                  </div>
                  {formData.dismissible && <X className="w-4 h-4 opacity-50 cursor-not-allowed" />}
               </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={isSaving || !formData.message.trim()}>
            {isSaving ? 'Saving...' : isEditing ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
