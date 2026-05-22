'use client';

import { useState, useEffect } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import NotificationModal from './NotificationModal';
import InfrastructureSyncPanel from './InfrastructureSyncPanel';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  Mail, 
  Shield, 
  Bell, 
  Save, 
  AlertTriangle, 
  CheckCircle2, 
  Plus, 
  Trash2, 
  Edit,
  Eye,
  EyeOff,
  ChevronDown,
  Database
} from "lucide-react";

interface SystemSettings {
  id: string;
  loginDisabled: boolean;
  internalRegistrationDisabled: boolean;
  externalRegistrationDisabled: boolean;
  manualOverride: boolean;
  lastModifiedBy: string | null;
  updatedAt: string;
  emailFrom: string | null;
  adminEmail: string | null;
  facultyEmail: string | null;
  studentDirectorEmails: string | null;
}

interface Notification {
  id: string;
  message: string;
  type: string;
  priority: number;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  dismissible: boolean;
  createdBy: string;
  createdAt: string;
}

interface SystemSettingsTabProps {
  isLoading: boolean;
  onRefresh: () => void;
}

export default function SystemSettingsTab({ isLoading, onRefresh }: SystemSettingsTabProps) {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Local state for settings
  const [loginDisabled, setLoginDisabled] = useState(false);
  const [internalRegistrationDisabled, setInternalRegistrationDisabled] = useState(false);
  const [externalRegistrationDisabled, setExternalRegistrationDisabled] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  
  // Email configuration state
  const [emailFrom, setEmailFrom] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [facultyEmail, setFacultyEmail] = useState('');
  const [studentDirectorEmails, setStudentDirectorEmails] = useState('');
  
  // Email visibility state
  const [showEmailFrom, setShowEmailFrom] = useState(false);
  const [showAdminEmail, setShowAdminEmail] = useState(false);
  const [showFacultyEmail, setShowFacultyEmail] = useState(false);
  const [showStudentDirectorEmails, setShowStudentDirectorEmails] = useState(false);

  // Notification form state
  const [showNotificationForm, setShowNotificationForm] = useState(false);
  const [editingNotification, setEditingNotification] = useState<Notification | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [notificationToDelete, setNotificationToDelete] = useState<string | null>(null);
  const [notificationForm, setNotificationForm] = useState({
    message: '',
    type: 'info',
    priority: 0,
    isActive: true,
    startDate: '',
    endDate: '',
    dismissible: true,
  });

  useEffect(() => {
    fetchSettings();
    fetchNotifications();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/admin/settings');
      if (!response.ok) throw new Error('Failed to fetch settings');
      const data = await response.json();
      setSettings(data.settings);
      
      setLoginDisabled(data.settings.loginDisabled);
      setInternalRegistrationDisabled(data.settings.internalRegistrationDisabled);
      setExternalRegistrationDisabled(data.settings.externalRegistrationDisabled);
      setManualOverride(data.settings.manualOverride);
      
      // Set email configuration
      setEmailFrom(data.settings.emailFrom || '');
      setAdminEmail(data.settings.adminEmail || '');
      setFacultyEmail(data.settings.facultyEmail || '');
      setStudentDirectorEmails(data.settings.studentDirectorEmails || '');
    } catch (error) {
      console.error('Error fetching settings:', error);
      setMessage({ type: 'error', text: 'Failed to load settings' });
    }
  };

  const fetchNotifications = async () => {
    try {
      const response = await fetch('/api/admin/notifications');
      if (!response.ok) throw new Error('Failed to fetch notifications');
      const data = await response.json();
      setNotifications(data.notifications || []);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setMessage(null);
    
    try {
      const updates = {
        loginDisabled,
        internalRegistrationDisabled,
        externalRegistrationDisabled,
        manualOverride,
        emailFrom: emailFrom || null,
        adminEmail: adminEmail || null,
        facultyEmail: facultyEmail || null,
        studentDirectorEmails: studentDirectorEmails || null,
      };

      const response = await fetchWithCsrf('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update settings');
      }

      const data = await response.json();
      setSettings(data.settings);
      setMessage({ type: 'success', text: data.message || 'Settings updated successfully' });
      onRefresh();
    } catch (error) {
      console.error('Error updating settings:', error);
      setMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : 'Failed to update settings'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoginToggle = (checked: boolean) => {
    if (settings?.manualOverride && settings.loginDisabled && !checked) {
      setMessage({ 
        type: 'error', 
        text: 'Login re-enabling is locked. Manual database override required.' 
      });
      return;
    }
    setLoginDisabled(checked);
  };

  const handleCreateNotification = () => {
    setEditingNotification(null);
    setNotificationForm({
      message: '',
      type: 'info',
      priority: 0,
      isActive: true,
      startDate: '',
      endDate: '',
      dismissible: true,
    });
    setShowNotificationForm(true);
  };

  const handleEditNotification = (notification: Notification) => {
    setEditingNotification(notification);
    
    // Convert ISO dates to datetime-local format (YYYY-MM-DDTHH:mm)
    const formatDateForInput = (dateString: string | null) => {
      if (!dateString) return '';
      const date = new Date(dateString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };
    
    setNotificationForm({
      message: notification.message,
      type: notification.type,
      priority: notification.priority,
      isActive: notification.isActive,
      startDate: formatDateForInput(notification.startDate),
      endDate: formatDateForInput(notification.endDate),
      dismissible: notification.dismissible,
    });
    setShowNotificationForm(true);
  };

  const handleSaveNotification = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      const url = editingNotification
        ? `/api/admin/notifications/${editingNotification.id}`
        : '/api/admin/notifications';
      
      const method = editingNotification ? 'PATCH' : 'POST';

      const response = await fetchWithCsrf(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notificationForm),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save notification');
      }

      const data = await response.json();
      setMessage({ type: 'success', text: data.message });
      setShowNotificationForm(false);
      await fetchNotifications();
    } catch (error) {
      console.error('Error saving notification:', error);
      setMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : 'Failed to save notification'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = (id: string) => {
    setNotificationToDelete(id);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!notificationToDelete) return;

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetchWithCsrf(`/api/admin/notifications/${notificationToDelete}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete notification');
      }

      setMessage({ type: 'success', text: 'Notification deleted successfully' });
      await fetchNotifications();
    } catch (error) {
      console.error('Error deleting notification:', error);
      setMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : 'Failed to delete notification'
      });
    } finally {
      setIsSaving(false);
      setShowDeleteConfirm(false);
      setNotificationToDelete(null);
    }
  };

  const getPriorityBadge = (priority: number) => {
    if (priority >= 10) return <Badge variant="destructive">High ({priority})</Badge>;
    if (priority >= 5) return <Badge className="bg-orange-500 hover:bg-orange-600">Medium ({priority})</Badge>;
    return <Badge variant="secondary">Low ({priority})</Badge>;
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'error': return <Badge variant="destructive">Error</Badge>;
      case 'warning': return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black">Warning</Badge>;
      case 'success': return <Badge className="bg-green-500 hover:bg-green-600">Success</Badge>;
      default: return <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-200">Info</Badge>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
           <div className="flex items-center justify-center space-x-2 animate-pulse">
             <div className="w-4 h-4 bg-gray-200 rounded-full"></div>
             <p className="text-gray-500">Loading settings...</p>
           </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">System Settings</h2>
          <p className="text-muted-foreground">Configure global application controls and notifications</p>
        </div>
        <Button onClick={handleSaveSettings} disabled={isSaving} className="gap-2">
          {isSaving ? <span className="animate-spin">⏳</span> : <Save className="w-4 h-4" />}
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className={message.type === 'success' ? 'bg-green-50 text-green-900 border-green-200' : ''}>
          {message.type === 'error' ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          <AlertTitle>{message.type === 'success' ? 'Success' : 'Error'}</AlertTitle>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" /> Access Control
            </CardTitle>
            <CardDescription>Manage login and registration availability</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between space-x-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="login-control" className="font-medium">Disable Logins</Label>
                <p className="text-sm text-muted-foreground">
                  Prevent all users from logging in. 
                  {settings?.manualOverride && loginDisabled && (
                    <span className="mt-1 inline-flex items-center gap-1 font-medium text-orange-600">
                      <AlertTriangle className="w-3 h-3" /> Manual override active - DB edit required
                    </span>
                  )}
                </p>
              </div>
              <Switch
                id="login-control"
                checked={loginDisabled}
                onCheckedChange={handleLoginToggle}
              />
            </div>

            {loginDisabled && (
              <div className="flex items-center justify-between space-x-4 pl-4 border-l-2 py-2 bg-muted/30 rounded-r-md">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="manual-override" className="text-sm font-medium">Database Manual Override</Label>
                  <p className="text-xs text-muted-foreground">Requires direct database modification to unlock</p>
                </div>
                <Switch
                  id="manual-override"
                  checked={manualOverride}
                  onCheckedChange={setManualOverride}
                />
              </div>
            )}

            <div className="border-t my-4"></div>

            <div className="flex items-center justify-between space-x-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="internal-reg" className="font-medium">Disable Internal Registration</Label>
                <p className="text-sm text-muted-foreground">Prevent new internal access requests</p>
              </div>
              <Switch
                id="internal-reg"
                checked={internalRegistrationDisabled}
                onCheckedChange={setInternalRegistrationDisabled}
              />
            </div>

            <div className="flex items-center justify-between space-x-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="external-reg" className="font-medium">Disable External Registration</Label>
                <p className="text-sm text-muted-foreground">Prevent new external access requests</p>
              </div>
              <Switch
                id="external-reg"
                checked={externalRegistrationDisabled}
                onCheckedChange={setExternalRegistrationDisabled}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
             <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" /> Email Configuration
             </CardTitle>
             <CardDescription>Override default email addresses</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
             <div className="space-y-2">
                <Label htmlFor="email-from">From Address</Label>
                <div className="relative">
                   <Input 
                      id="email-from" 
                      type={showEmailFrom ? "text" : "password"}
                      value={emailFrom}
                      onChange={(e) => setEmailFrom(e.target.value)}
                      placeholder="noreply@cpp.edu" 
                      className="pr-10"
                   />
                   <button
                      type="button"
                      onClick={() => setShowEmailFrom(!showEmailFrom)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                   >
                      {showEmailFrom ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                   </button>
                </div>
             </div>

             <div className="space-y-2">
                <Label htmlFor="email-admin">Admin Email</Label>
                <div className="relative">
                   <Input 
                      id="email-admin" 
                      type={showAdminEmail ? "text" : "password"}
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="admin@cpp.edu" 
                      className="pr-10"
                   />
                   <button
                      type="button"
                      onClick={() => setShowAdminEmail(!showAdminEmail)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                   >
                      {showAdminEmail ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                   </button>
                </div>
             </div>

             <div className="space-y-2">
                <Label htmlFor="email-faculty">Faculty Email</Label>
                <div className="relative">
                   <Input 
                      id="email-faculty" 
                      type={showFacultyEmail ? "text" : "password"}
                      value={facultyEmail}
                      onChange={(e) => setFacultyEmail(e.target.value)}
                      placeholder="faculty@cpp.edu" 
                      className="pr-10"
                   />
                   <button
                      type="button"
                      onClick={() => setShowFacultyEmail(!showFacultyEmail)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                   >
                      {showFacultyEmail ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                   </button>
                </div>
             </div>

             <div className="space-y-2">
                <Label htmlFor="email-directors">Student Directors</Label>
                <div className="relative">
                   <Input 
                      id="email-directors" 
                      type={showStudentDirectorEmails ? "text" : "password"}
                      value={studentDirectorEmails}
                      onChange={(e) => setStudentDirectorEmails(e.target.value)}
                      placeholder="director1@cpp.edu, director2@cpp.edu" 
                      className="pr-10"
                   />
                   <button
                      type="button"
                      onClick={() => setShowStudentDirectorEmails(!showStudentDirectorEmails)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                   >
                      {showStudentDirectorEmails ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                   </button>
                </div>
                <p className="text-xs text-muted-foreground">Comma-separated list</p>
             </div>
          </CardContent>
        </Card>
      </div>

      <Collapsible>
         <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="flex flex-row items-center justify-between hover:bg-muted/50 transition-colors rounded-t-lg">
                 <div className="flex flex-col items-start gap-1">
                    <CardTitle className="flex items-center gap-2 cursor-pointer text-base">
                       <Database className="w-5 h-5" /> Infrastructure Management
                    </CardTitle>
                 </div>
                 <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform duration-200" />
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
               <CardContent className="pt-4 border-t">
                  <InfrastructureSyncPanel />
               </CardContent>
            </CollapsibleContent>
         </Card>
      </Collapsible>

      <Card>
         <CardHeader>
            <div className="flex items-center justify-between">
               <div>
                  <CardTitle className="flex items-center gap-2">
                     <Bell className="w-5 h-5" /> Notification Banners
                  </CardTitle>
                  <CardDescription className="mt-1">Manage global site notifications</CardDescription>
               </div>
               <Button onClick={handleCreateNotification} size="sm" className="gap-2">
                  <Plus className="w-4 h-4" /> Create Notification
               </Button>
            </div>
         </CardHeader>
         <CardContent>
            <div className="space-y-4">
               {notifications.length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed rounded-lg bg-muted/10">
                     <p className="text-muted-foreground mb-4">No active notifications</p>
                     <Button variant="outline" onClick={handleCreateNotification}>Create Your First Notification</Button>
                  </div>
               ) : (
                  <div className="grid gap-4">
                     {notifications.map((notification) => (
                        <div key={notification.id} className="flex items-start justify-between p-4 border rounded-lg bg-card hover:shadow-sm transition-shadow">
                           <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                 {getTypeBadge(notification.type)}
                                 {getPriorityBadge(notification.priority)}
                                 {!notification.isActive && <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>}
                                 {!notification.dismissible && <Badge variant="outline" className="border-orange-200 text-orange-700 bg-orange-50">Permanent</Badge>}
                              </div>
                              <p className="font-medium pt-1">{notification.message}</p>
                              <div className="flex gap-4 text-xs text-muted-foreground pt-1">
                                 <span>Created by {notification.createdBy}</span>
                                 <span>{new Date(notification.createdAt).toLocaleDateString()}</span>
                                 {(notification.startDate || notification.endDate) && (
                                     <span>
                                        {notification.startDate ? new Date(notification.startDate).toLocaleDateString() : 'Now'} 
                                        {' → '} 
                                        {notification.endDate ? new Date(notification.endDate).toLocaleDateString() : 'Forever'}
                                     </span>
                                 )}
                              </div>
                           </div>
                           <div className="flex gap-2">
                              <Button variant="ghost" size="icon" onClick={() => handleEditNotification(notification)}>
                                 <Edit className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteClick(notification.id)}>
                                 <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                              </Button>
                           </div>
                        </div>
                     ))}
                  </div>
               )}
            </div>
         </CardContent>
      </Card>

      {settings && (
         <div className="text-xs text-muted-foreground text-right px-1">
            Last updated by {settings.lastModifiedBy || 'system'} on {new Date(settings.updatedAt).toLocaleString()}
         </div>
      )}

      <NotificationModal
        isOpen={showNotificationForm}
        onClose={() => setShowNotificationForm(false)}
        onSave={handleSaveNotification}
        formData={notificationForm}
        setFormData={setNotificationForm}
        isEditing={!!editingNotification}
        isSaving={isSaving}
      />
      <ActionAlertDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Notification"
        description="Are you sure you want to delete this notification? This action cannot be undone."
        onConfirm={handleConfirmDelete}
        confirmLabel={isSaving ? "Deleting..." : "Delete"}
        cancelLabel="Cancel"
        variant="destructive"
      />
    </div>
  );
}

// Reusable Alert Dialog Component (Inline)
function ActionAlertDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel,
  cancelLabel,
  variant = 'default'
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  confirmLabel: string;
  cancelLabel: string;
  variant?: 'default' | 'destructive';
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction 
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className={variant === 'destructive' ? 'bg-red-600 hover:bg-red-700' : ''}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
