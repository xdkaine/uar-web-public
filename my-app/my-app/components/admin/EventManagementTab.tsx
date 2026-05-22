'use client';

import { useState, useCallback, useEffect } from 'react';
import EventModal from './EventModal';
import { fetchWithCsrf } from '@/lib/csrf';
import { usePolling } from '@/hooks/usePolling';
import { Button } from "@/components/ui/button";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { 
  Plus, 
  RefreshCw, 
  Play, 
  Pause,
  Edit,
  Trash2,
  Power,
  PowerOff
} from "lucide-react";
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

interface Event {
  id: string;
  name: string;
  description?: string;
  endDate?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count: {
    accessRequests: number;
  };
}

interface EventManagementTabProps {
  events?: Event[];
  isLoading?: boolean;
}

export default function EventManagementTab({ events, isLoading = false }: EventManagementTabProps) {
  const [localEvents, setLocalEvents] = useState<Event[]>(events ?? []);

  const fetchEvents = useCallback(async () => {
    const response = await fetch('/api/admin/events');
    if (!response.ok) throw new Error('Failed to fetch events');
    const data = await response.json();
    return data.events || [];
  }, []);

  const { 
    isLoading: isPollingLoading, 
    isPolling, 
    togglePolling, 
    refresh
  } = usePolling(fetchEvents, {
    interval: 30000,
    onSuccess: (data) => {
      setLocalEvents(data);
    }
  });

  useEffect(() => {
    if (events !== undefined) {
      setLocalEvents(events);
    }
  }, [events]);

  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [eventFormData, setEventFormData] = useState({
    name: '',
    description: '',
    endDate: '',
    isActive: true,
  });

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<string | null>(null);

  const handleCreateEvent = () => {
    setEditingEvent(null);
    setEventFormData({ name: '', description: '', endDate: '', isActive: true });
    setShowEventModal(true);
  };

  const handleEditEvent = (event: Event) => {
    setEditingEvent(event);
    
    // Convert stored ISO datetime to local datetime format (YYYY-MM-DDTHH:mm) for DateTimePicker
    let endDateTime = '';
    if (event.endDate) {
      const date = new Date(event.endDate);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      endDateTime = `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    
    setEventFormData({
      name: event.name,
      description: event.description || '',
      endDate: endDateTime,
      isActive: event.isActive,
    });
    setShowEventModal(true);
  };

  const handleSaveEvent = async () => {
    try {
      const url = editingEvent 
        ? `/api/admin/events/${editingEvent.id}`
        : '/api/admin/events';
      const method = editingEvent ? 'PATCH' : 'POST';

      // Convert local datetime (YYYY-MM-DDTHH:mm) to full ISO string with seconds
      let endDateISO = null;
      if (eventFormData.endDate) {
        const dateTimeWithSeconds = eventFormData.endDate.includes(':00') 
          ? eventFormData.endDate 
          : `${eventFormData.endDate}:00`;
        endDateISO = new Date(dateTimeWithSeconds).toISOString();
      }

      const payload = {
        name: eventFormData.name,
        description: eventFormData.description,
        endDate: endDateISO,
        isActive: eventFormData.isActive,
      };

      const response = await fetchWithCsrf(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to save event');
      }

      setShowEventModal(false);
      refresh();
    } catch (error) {
      console.error('Error saving event:', error);
      alert('Failed to save event. Please try again.');
    }
  };

  const handleToggleEventStatus = async (eventId: string, currentStatus: boolean) => {
    try {
      const response = await fetchWithCsrf(`/api/admin/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentStatus }),
      });

      if (!response.ok) {
        throw new Error('Failed to update event status');
      }

      refresh();
    } catch (error) {
      console.error('Error updating event status:', error);
      alert('Failed to update event status. Please try again.');
    }
  };

  const confirmDeleteEvent = (eventId: string) => {
    setEventToDelete(eventId);
    setShowDeleteConfirm(true);
  };

  const handleDeleteEvent = async () => {
    if (!eventToDelete) return;

    try {
      const response = await fetchWithCsrf(`/api/admin/events/${eventToDelete}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete event');
      }

      refresh();
    } catch (error) {
      console.error('Error deleting event:', error);
      alert('Failed to delete event. Please try again.');
    } finally {
      setShowDeleteConfirm(false);
      setEventToDelete(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-900">Event Management</h2>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-4 bg-white p-2 rounded-lg shadow-sm border border-gray-100">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
              <span className="text-xs text-gray-500 font-medium uppercase tracking-wider hidden sm:inline">
                {isPolling ? 'Live' : 'Paused'}
              </span>
            </div>
            
            <div className="h-4 w-px bg-gray-200"></div>

            <div className="flex items-center gap-2">
              <Button
                variant={isPolling ? "ghost" : "secondary"}
                size="icon"
                onClick={() => togglePolling()}
                className={`h-8 w-8 ${
                  isPolling 
                    ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' 
                    : 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                }`}
                title={isPolling ? "Pause updates" : "Resume updates"}
              >
                {isPolling ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
              
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refresh()}
                disabled={isPollingLoading}
                className="h-8 w-8 text-gray-500 hover:text-blue-600 hover:bg-blue-50"
                title="Refresh now"
              >
                <RefreshCw className={`h-4 w-4 ${isPollingLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          <Button
            onClick={handleCreateEvent}
            className="bg-black hover:bg-gray-800 text-white font-semibold gap-2"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Create Event</span>
          </Button>
        </div>
      </div>

      {(isLoading || isPollingLoading) && !localEvents.length ? (
        <div className="text-center py-8 text-gray-600">Loading events...</div>
      ) : localEvents.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-gray-600 mb-4">No events created yet.</p>
          <Button
            onClick={handleCreateEvent}
            className="bg-black hover:bg-gray-800 text-white font-semibold"
          >
            Create Your First Event
          </Button>
        </Card>
      ) : (
        <div className="bg-white rounded-lg shadow-xl border-2 border-gray-200 overflow-hidden">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Event Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requests</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {localEvents.map((event) => (
                <TableRow key={event.id} className="hover:bg-gray-50">
                  <TableCell className="font-medium text-gray-900">{event.name}</TableCell>
                  <TableCell className="text-gray-600">
                    {event.description || <span className="text-gray-400">—</span>}
                  </TableCell>
                  <TableCell className="text-gray-600 whitespace-nowrap">
                    {event.endDate ? new Date(event.endDate).toLocaleString('en-US', { 
                      month: 'short', 
                      day: 'numeric', 
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    }) : <span className="text-gray-400">—</span>}
                  </TableCell>
                  <TableCell>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      event.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {event.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </TableCell>
                  <TableCell className="text-gray-600">
                    {event._count.accessRequests}
                  </TableCell>
                  <TableCell className="text-gray-600 whitespace-nowrap">
                    {new Date(event.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditEvent(event)}
                        className="text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleEventStatus(event.id, event.isActive)}
                        className={`${
                          event.isActive 
                            ? 'text-yellow-600 hover:text-yellow-800 hover:bg-yellow-50' 
                            : 'text-green-600 hover:text-green-800 hover:bg-green-50'
                        }`}
                      >
                        {event.isActive ? (
                          <>
                            <PowerOff className="h-4 w-4 mr-1" />
                            Disable
                          </>
                        ) : (
                          <>
                            <Power className="h-4 w-4 mr-1" />
                            Enable
                          </>
                        )}
                      </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => confirmDeleteEvent(event.id)}
                          className="text-red-600 hover:text-red-800 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <EventModal
        isOpen={showEventModal}
        onClose={() => setShowEventModal(false)}
        onSave={handleSaveEvent}
        formData={eventFormData}
        setFormData={setEventFormData}
        isEditing={!!editingEvent}
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this event? If it has associated requests, it will be disabled instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => {
                e.preventDefault();
                handleDeleteEvent();
              }}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
