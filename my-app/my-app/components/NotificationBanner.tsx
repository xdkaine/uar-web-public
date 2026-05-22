'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface Notification {
  id: string;
  message: string;
  type: string;
  priority: number;
  dismissible: boolean;
}

export default function NotificationBanner() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/banner');
      if (response.ok) {
        const data = await response.json();
        if (data.notifications && data.notifications.length > 0) {
          setNotifications(data.notifications);
        }
      }
    } catch (error) {
      console.error('Error fetching notification banners:', error);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    
    // Refetch notifications every 5 minutes
    const interval = setInterval(fetchNotifications, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const dismissNotification = (id: string) => {
    setDismissedIds(prev => new Set(prev).add(id));
  };

  const visibleNotifications = notifications.filter(n => !dismissedIds.has(n.id));

  if (visibleNotifications.length === 0) {
    return null;
  }

  const getBannerStyles = (type: string) => {
    switch (type) {
      case 'warning':
        return 'bg-yellow-50 text-yellow-900 border-yellow-300';
      case 'error':
        return 'bg-red-50 text-red-900 border-red-300';
      case 'success':
        return 'bg-green-50 text-green-900 border-green-300';
      case 'info':
      default:
        return 'bg-blue-50 text-blue-900 border-blue-300';
    }
  };

  const getIconColor = (type: string) => {
    switch (type) {
      case 'warning':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      case 'success':
        return 'text-green-600';
      case 'info':
      default:
        return 'text-blue-600';
    }
  };

  const renderIcon = (type: string) => {
    if (type === 'error') {
      return (
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd"
        />
      );
    }
    if (type === 'warning') {
      return (
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      );
    }
    if (type === 'success') {
      return (
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          clipRule="evenodd"
        />
      );
    }
    // info
    return (
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
        clipRule="evenodd"
      />
    );
  };

  return (
    <div className="flex flex-col">
      {visibleNotifications.map((notification) => (
        <div key={notification.id} className={`border-b-2 ${getBannerStyles(notification.type)}`}>
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1">
                <svg
                  className={`w-5 h-5 flex-shrink-0 ${getIconColor(notification.type)}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  {renderIcon(notification.type)}
                </svg>
                <p className="text-sm font-medium">{notification.message}</p>
              </div>
              {notification.dismissible && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => dismissNotification(notification.id)}
                  className="flex-shrink-0 h-6 w-6 hover:bg-black/5"
                  aria-label="Dismiss notification"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
