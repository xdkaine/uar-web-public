"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import EventModal from "./EventModal";
import { DestructiveConfirmationDialog } from "./DestructiveConfirmationDialog";
import {
  EventManagementContent,
  type ManagedEvent,
} from "./EventManagementContent";
import { fetchWithCsrf } from "@/lib/csrf";
import { usePolling } from "@/hooks/usePolling";

interface Event extends ManagedEvent {
  updatedAt: string;
}

interface EventManagementTabProps {
  events?: Event[];
  isLoading?: boolean;
}

export default function EventManagementTab({
  events,
  isLoading = false,
}: EventManagementTabProps) {
  const [localEvents, setLocalEvents] = useState<Event[]>(events ?? []);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ManagedEvent | null>(null);
  const [eventFormData, setEventFormData] = useState({
    name: "",
    description: "",
    endDate: "",
    isActive: true,
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const eventToDeleteRef = useRef<string | null>(null);

  const fetchEvents = useCallback(async () => {
    const response = await fetch("/api/admin/events");
    if (!response.ok) throw new Error("Failed to fetch events");
    const data = await response.json();
    return data.events || [];
  }, []);
  const {
    isLoading: isPollingLoading,
    isPolling,
    togglePolling,
    refresh,
  } = usePolling(fetchEvents, { interval: 30000, onSuccess: setLocalEvents });

  useEffect(() => {
    if (events !== undefined) setLocalEvents(events);
  }, [events]);

  const handleCreateEvent = () => {
    setEditingEvent(null);
    setEventFormData({
      name: "",
      description: "",
      endDate: "",
      isActive: true,
    });
    setShowEventModal(true);
  };

  const handleEditEvent = (event: ManagedEvent) => {
    setEditingEvent(event);
    const endDate = event.endDate || "";
    setEventFormData({
      name: event.name,
      description: event.description || "",
      endDate,
      isActive: event.isActive,
    });
    setShowEventModal(true);
  };

  const handleSaveEvent = async () => {
    try {
      const response = await fetchWithCsrf(
        editingEvent
          ? `/api/admin/events/${editingEvent.id}`
          : "/api/admin/events",
        {
          method: editingEvent ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: eventFormData.name,
            description: eventFormData.description,
            endDate: eventFormData.endDate
              ? new Date(eventFormData.endDate).toISOString()
              : null,
            isActive: eventFormData.isActive,
          }),
        },
      );
      if (!response.ok) throw new Error("Failed to save event");
      setShowEventModal(false);
      refresh();
    } catch (error) {
      console.error("Error saving event:", error);
      alert("Failed to save event. Please try again.");
    }
  };

  const handleToggleEventStatus = async (event: ManagedEvent) => {
    try {
      const response = await fetchWithCsrf(`/api/admin/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !event.isActive }),
      });
      if (!response.ok) throw new Error("Failed to update event status");
      refresh();
    } catch (error) {
      console.error("Error updating event status:", error);
      alert("Failed to update event status. Please try again.");
    }
  };

  const confirmDeleteEvent = (eventId: string) => {
    eventToDeleteRef.current = eventId;
    setShowDeleteConfirm(true);
  };

  const handleDeleteEvent = async () => {
    const eventId = eventToDeleteRef.current;
    if (!eventId) return;
    try {
      const response = await fetchWithCsrf(`/api/admin/events/${eventId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete event");
      refresh();
    } catch (error) {
      console.error("Error deleting event:", error);
      alert("Failed to delete event. Please try again.");
    } finally {
      setShowDeleteConfirm(false);
      eventToDeleteRef.current = null;
    }
  };

  return (
    <div>
      <EventManagementContent
        events={localEvents}
        isLoading={isLoading}
        isPolling={isPolling}
        isPollingLoading={isPollingLoading}
        onCreate={handleCreateEvent}
        onEdit={handleEditEvent}
        onToggle={(event) => void handleToggleEventStatus(event)}
        onDelete={confirmDeleteEvent}
        onRefresh={() => void refresh()}
        onTogglePolling={togglePolling}
      />
      <EventModal
        isOpen={showEventModal}
        onClose={() => setShowEventModal(false)}
        onSave={handleSaveEvent}
        formData={eventFormData}
        setFormData={setEventFormData}
        isEditing={!!editingEvent}
      />
      <DestructiveConfirmationDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Event?"
        description="Are you sure you want to delete this event? If it has associated requests, it will be disabled instead."
        onConfirm={() => void handleDeleteEvent()}
      />
    </div>
  );
}
