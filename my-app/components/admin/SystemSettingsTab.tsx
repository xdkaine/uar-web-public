'use client';

import { useReducer, useState } from 'react';
import useSWR from 'swr';
import { fetchWithCsrf } from '@/lib/csrf';
import { fetchJson } from '@/lib/client-query';
import InfrastructureSyncPanel from './InfrastructureSyncPanel';
import SystemSettingsNotifications from './SystemSettingsNotifications';
import { ClientLocalDate } from './ClientLocalDate';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Power,
  Save,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Database
} from "lucide-react";

interface SystemSettings {
  id: string | null;
  loginDisabled: boolean;
  internalRegistrationDisabled: boolean;
  externalRegistrationDisabled: boolean;
  manualOverride: boolean;
  lastModifiedBy: string | null;
  updatedAt: string | null;
}

interface SystemSettingsTabProps {
  isLoading: boolean;
  onRefresh: () => void;
}

interface SettingsDraft {
  loginDisabled: boolean;
  internalRegistrationDisabled: boolean;
  externalRegistrationDisabled: boolean;
  manualOverride: boolean;
}

type SettingsDraftAction =
  | { type: 'hydrate'; settings: SystemSettings }
  | { type: 'set'; field: keyof SettingsDraft; value: boolean };

function settingsDraftReducer(state: SettingsDraft, action: SettingsDraftAction): SettingsDraft {
  if (action.type === 'hydrate') {
    return {
      loginDisabled: action.settings.loginDisabled,
      internalRegistrationDisabled: action.settings.internalRegistrationDisabled,
      externalRegistrationDisabled: action.settings.externalRegistrationDisabled,
      manualOverride: action.settings.manualOverride,
    };
  }

  return { ...state, [action.field]: action.value };
}

export default function SystemSettingsTab({ isLoading, onRefresh }: SystemSettingsTabProps) {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [draft, dispatchDraft] = useReducer(settingsDraftReducer, {
    loginDisabled: false,
    internalRegistrationDisabled: false,
    externalRegistrationDisabled: false,
    manualOverride: false,
  });

  useSWR<{ settings: SystemSettings }>('/api/admin/settings', fetchJson, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    onSuccess: (data) => {
      setSettings(data.settings);
      dispatchDraft({ type: 'hydrate', settings: data.settings });
    },
    onError: () => setMessage({ type: 'error', text: 'Failed to load settings' }),
  });

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setMessage(null);
    
    try {
      const updates = {
        loginDisabled: draft.loginDisabled,
        internalRegistrationDisabled: draft.internalRegistrationDisabled,
        externalRegistrationDisabled: draft.externalRegistrationDisabled,
        manualOverride: draft.manualOverride,
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
    if (settings?.manualOverride && draft.loginDisabled && !checked) {
      setMessage({ 
        type: 'error', 
        text: 'Login re-enabling is locked. Manual database override required.' 
      });
      return;
    }
    dispatchDraft({ type: 'set', field: 'loginDisabled', value: checked });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
           <div className="flex items-center justify-center space-x-2 animate-pulse">
             <div className="w-4 h-4 bg-muted rounded-full"></div>
             <p className="text-muted-foreground">Loading settings...</p>
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
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className={message.type === 'success' ? 'bg-green-50 dark:bg-green-950/40 text-green-900 border-green-200 dark:border-green-900' : ''}>
          {message.type === 'error' ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          <AlertTitle>{message.type === 'success' ? 'Success' : 'Error'}</AlertTitle>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card id="service-availability" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Power className="w-5 h-5" /> Service Availability
            </CardTitle>
            <CardDescription>Emergency global stops for sign-in and request intake. Configure identity sources on the Sign-in tab.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between space-x-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="login-control" className="font-medium">Disable Logins</Label>
                <p className="text-sm text-muted-foreground">
                  Prevent all users from logging in. 
                  {settings?.manualOverride && draft.loginDisabled && (
                    <span className="mt-1 inline-flex items-center gap-1 font-medium text-orange-600 dark:text-orange-400">
                      <AlertTriangle className="w-3 h-3" /> Manual override active - DB edit required
                    </span>
                  )}
                </p>
              </div>
              <Switch
                id="login-control"
                checked={draft.loginDisabled}
                onCheckedChange={handleLoginToggle}
              />
            </div>

            {draft.loginDisabled && (
              <div className="flex items-center justify-between space-x-4 pl-4 border-l-2 py-2 bg-muted/30 rounded-r-md">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="manual-override" className="text-sm font-medium">Database Manual Override</Label>
                  <p className="text-xs text-muted-foreground">Requires direct database modification to unlock</p>
                </div>
                <Switch
                  id="manual-override"
                  checked={draft.manualOverride}
                  onCheckedChange={(checked) => dispatchDraft({ type: 'set', field: 'manualOverride', value: checked })}
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
                checked={draft.internalRegistrationDisabled}
                onCheckedChange={(checked) => dispatchDraft({ type: 'set', field: 'internalRegistrationDisabled', value: checked })}
              />
            </div>

            <div className="flex items-center justify-between space-x-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="external-reg" className="font-medium">Disable External Registration</Label>
                <p className="text-sm text-muted-foreground">Prevent new external access requests</p>
              </div>
              <Switch
                id="external-reg"
                checked={draft.externalRegistrationDisabled}
                onCheckedChange={(checked) => dispatchDraft({ type: 'set', field: 'externalRegistrationDisabled', value: checked })}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Collapsible>
         <Card id="infrastructure-management" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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

      <SystemSettingsNotifications />

      {settings && (
         <div className="text-xs text-muted-foreground text-right px-1">
            {settings.updatedAt
              ? <>Last updated by {settings.lastModifiedBy || 'system'} on <ClientLocalDate value={settings.updatedAt} /></>
              : 'Default settings; no changes saved yet'}
         </div>
      )}

    </div>
  );
}
