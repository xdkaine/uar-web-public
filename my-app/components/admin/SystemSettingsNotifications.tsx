'use client';

import { useReducer, useRef } from 'react';
import useSWR from 'swr';
import { fetchWithCsrf } from '@/lib/csrf';
import { fetchJson } from '@/lib/client-query';
import NotificationModal from './NotificationModal';
import { ClientLocalDate } from './ClientLocalDate';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, Bell, CheckCircle2, Edit, Plus, Trash2 } from 'lucide-react';

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

interface NotificationForm {
  message: string;
  type: string;
  priority: number;
  isActive: boolean;
  startDate: string;
  endDate: string;
  dismissible: boolean;
}

interface NotificationState {
  isSaving: boolean;
  message: { type: 'success' | 'error'; text: string } | null;
  showForm: boolean;
  editing: Notification | null;
  showDeleteConfirm: boolean;
  form: NotificationForm;
}

type NotificationAction =
  | { type: 'set-saving'; isSaving: boolean }
  | { type: 'set-message'; message: NotificationState['message'] }
  | { type: 'open-create' }
  | { type: 'open-edit'; notification: Notification }
  | { type: 'close-form' }
  | { type: 'set-form'; form: NotificationForm }
  | { type: 'open-delete' }
  | { type: 'close-delete' };

const defaultNotificationForm: NotificationForm = {
  message: '',
  type: 'info',
  priority: 0,
  isActive: true,
  startDate: '',
  endDate: '',
  dismissible: true,
};

const initialState: NotificationState = {
  isSaving: false,
  message: null,
  showForm: false,
  editing: null,
  showDeleteConfirm: false,
  form: defaultNotificationForm,
};

function formatDateForInput(dateString: string | null) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function notificationReducer(state: NotificationState, action: NotificationAction): NotificationState {
  switch (action.type) {
    case 'set-saving':
      return { ...state, isSaving: action.isSaving };
    case 'set-message':
      return { ...state, message: action.message };
    case 'open-create':
      return { ...state, editing: null, form: { ...defaultNotificationForm }, showForm: true };
    case 'open-edit':
      return {
        ...state,
        editing: action.notification,
        form: {
          message: action.notification.message,
          type: action.notification.type,
          priority: action.notification.priority,
          isActive: action.notification.isActive,
          startDate: formatDateForInput(action.notification.startDate),
          endDate: formatDateForInput(action.notification.endDate),
          dismissible: action.notification.dismissible,
        },
        showForm: true,
      };
    case 'close-form':
      return { ...state, showForm: false };
    case 'set-form':
      return { ...state, form: action.form };
    case 'open-delete':
      return { ...state, showDeleteConfirm: true };
    case 'close-delete':
      return { ...state, showDeleteConfirm: false };
  }
}

function getPriorityBadge(priority: number) {
  if (priority >= 10) return <Badge variant="destructive">High ({priority})</Badge>;
  if (priority >= 5) return <Badge className="bg-orange-500 hover:bg-orange-600">Medium ({priority})</Badge>;
  return <Badge variant="secondary">Low ({priority})</Badge>;
}

function getTypeBadge(type: string) {
  if (type === 'error') return <Badge variant="destructive">Error</Badge>;
  if (type === 'warning') return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black">Warning</Badge>;
  if (type === 'success') return <Badge className="bg-green-500 hover:bg-green-600">Success</Badge>;
  return <Badge variant="secondary" className="bg-blue-100 dark:bg-blue-950/60 text-blue-800 hover:bg-blue-200">Info</Badge>;
}

function NotificationFeedback({ message }: Pick<NotificationState, 'message'>) {
  if (!message) return null;

  return (
    <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className={message.type === 'success' ? 'bg-green-50 dark:bg-green-950/40 text-green-900 border-green-200 dark:border-green-900' : ''}>
      {message.type === 'error' ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
      <AlertTitle>{message.type === 'success' ? 'Success' : 'Error'}</AlertTitle>
      <AlertDescription>{message.text}</AlertDescription>
    </Alert>
  );
}

function NotificationBannersCard({
  notifications,
  onCreate,
  onEdit,
  onDelete,
}: {
  notifications: Notification[];
  onCreate: () => void;
  onEdit: (notification: Notification) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card id="notification-banners" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" /> Notification Banners
            </CardTitle>
            <CardDescription className="mt-1">Manage global site notifications</CardDescription>
          </div>
          <Button onClick={onCreate} size="sm" className="gap-2">
            <Plus className="w-4 h-4" /> Create Notification
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {notifications.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed rounded-lg bg-muted/10">
              <p className="text-muted-foreground mb-4">No active notifications</p>
              <Button variant="outline" onClick={onCreate}>Create Your First Notification</Button>
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
                      {!notification.dismissible && <Badge variant="outline" className="border-orange-200 dark:border-orange-900 text-orange-700 dark:text-orange-200 bg-orange-50 dark:bg-orange-950/40">Permanent</Badge>}
                    </div>
                    <p className="font-medium pt-1">{notification.message}</p>
                    <div className="flex gap-4 text-xs text-muted-foreground pt-1">
                      <span>Created by {notification.createdBy}</span>
                      <span><ClientLocalDate value={notification.createdAt} format="date" /></span>
                      {(notification.startDate || notification.endDate) && (
                        <span>
                          {notification.startDate ? <ClientLocalDate value={notification.startDate} format="date" /> : 'Now'}
                          {' → '}
                          {notification.endDate ? <ClientLocalDate value={notification.endDate} format="date" /> : 'Forever'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" aria-label={`Edit notification: ${notification.message}`} onClick={() => onEdit(notification)}>
                      <Edit className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete notification: ${notification.message}`} onClick={() => onDelete(notification.id)}>
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
  );
}

function NotificationDeleteDialog({
  open,
  isSaving,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Notification</AlertDialogTitle>
          <AlertDialogDescription>Are you sure you want to delete this notification? This action cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            className="bg-red-600 hover:bg-red-700"
          >
            {isSaving ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function SystemSettingsNotifications() {
  const [state, dispatch] = useReducer(notificationReducer, initialState);
  const notificationToDelete = useRef<string | null>(null);
  const { data, mutate } = useSWR<{ notifications?: Notification[] }>('/api/admin/notifications', fetchJson, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const notifications = data?.notifications || [];

  const fetchNotifications = async () => {
    try {
      const response = await fetch('/api/admin/notifications');
      if (!response.ok) throw new Error('Failed to fetch notifications');
      const nextData = await response.json() as { notifications?: Notification[] };
      await mutate({ notifications: nextData.notifications || [] }, false);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  const handleSaveNotification = async () => {
    dispatch({ type: 'set-saving', isSaving: true });
    dispatch({ type: 'set-message', message: null });

    try {
      const url = state.editing
        ? `/api/admin/notifications/${state.editing.id}`
        : '/api/admin/notifications';
      const method = state.editing ? 'PATCH' : 'POST';
      const response = await fetchWithCsrf(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.form),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save notification');
      }

      const responseData = await response.json();
      dispatch({ type: 'set-message', message: { type: 'success', text: responseData.message } });
      dispatch({ type: 'close-form' });
      await fetchNotifications();
    } catch (error) {
      console.error('Error saving notification:', error);
      dispatch({
        type: 'set-message',
        message: { type: 'error', text: error instanceof Error ? error.message : 'Failed to save notification' },
      });
    } finally {
      dispatch({ type: 'set-saving', isSaving: false });
    }
  };

  const handleConfirmDelete = async () => {
    if (!notificationToDelete.current) return;
    dispatch({ type: 'set-saving', isSaving: true });
    dispatch({ type: 'set-message', message: null });

    try {
      const response = await fetchWithCsrf(`/api/admin/notifications/${notificationToDelete.current}`, { method: 'DELETE' });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete notification');
      }

      dispatch({ type: 'set-message', message: { type: 'success', text: 'Notification deleted successfully' } });
      await fetchNotifications();
    } catch (error) {
      console.error('Error deleting notification:', error);
      dispatch({
        type: 'set-message',
        message: { type: 'error', text: error instanceof Error ? error.message : 'Failed to delete notification' },
      });
    } finally {
      dispatch({ type: 'set-saving', isSaving: false });
      dispatch({ type: 'close-delete' });
      notificationToDelete.current = null;
    }
  };

  const handleDelete = (id: string) => {
    notificationToDelete.current = id;
    dispatch({ type: 'open-delete' });
  };

  return (
    <div className="space-y-6">
      <NotificationFeedback message={state.message} />
      <NotificationBannersCard
        notifications={notifications}
        onCreate={() => dispatch({ type: 'open-create' })}
        onEdit={(notification) => dispatch({ type: 'open-edit', notification })}
        onDelete={handleDelete}
      />
      <NotificationModal
        isOpen={state.showForm}
        onClose={() => dispatch({ type: 'close-form' })}
        onSave={handleSaveNotification}
        formData={state.form}
        setFormData={(form) => dispatch({ type: 'set-form', form })}
        isEditing={!!state.editing}
        isSaving={state.isSaving}
      />
      <NotificationDeleteDialog
        open={state.showDeleteConfirm}
        isSaving={state.isSaving}
        onOpenChange={(open) => dispatch({ type: open ? 'open-delete' : 'close-delete' })}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
