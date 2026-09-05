import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Edit,
  Pause,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { ClientEventLocalDate } from "./ClientEventLocalDate";

export interface ManagedEvent {
  id: string;
  name: string;
  description?: string;
  endDate?: string;
  isActive: boolean;
  createdAt: string;
  _count: { accessRequests: number };
}

interface EventManagementContentProps {
  events: ManagedEvent[];
  isLoading: boolean;
  isPolling: boolean;
  isPollingLoading: boolean;
  onCreate: () => void;
  onEdit: (event: ManagedEvent) => void;
  onToggle: (event: ManagedEvent) => void;
  onDelete: (eventId: string) => void;
  onRefresh: () => void;
  onTogglePolling: () => void;
}

export function EventManagementContent({
  events,
  isLoading,
  isPolling,
  isPollingLoading,
  onCreate,
  onEdit,
  onToggle,
  onDelete,
  onRefresh,
  onTogglePolling,
}: EventManagementContentProps) {
  return (
    <>
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-foreground">Event Management</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-4 bg-card p-2 rounded-lg shadow-sm border border-border">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${isPolling ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`}
              />
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider hidden sm:inline">
                {isPolling ? "Live" : "Paused"}
              </span>
            </div>
            <div className="h-4 w-px bg-muted" />
            <div className="flex items-center gap-2">
              <Button
                variant={isPolling ? "ghost" : "secondary"}
                size="icon"
                onClick={onTogglePolling}
                className={`h-8 w-8 ${isPolling ? "text-muted-foreground hover:text-muted-foreground hover:bg-muted" : "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100"}`}
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
                onClick={onRefresh}
                disabled={isPollingLoading}
                className="h-8 w-8 text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 dark:text-blue-400 hover:bg-blue-50 dark:bg-blue-950/40"
                title="Refresh now"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isPollingLoading ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
          </div>
          <Button
            onClick={onCreate}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-2"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Create Event</span>
          </Button>
        </div>
      </div>

      {(isLoading || isPollingLoading) && !events.length ? (
        <div className="text-center py-8 text-muted-foreground">
          Loading events...
        </div>
      ) : events.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground mb-4">No events created yet.</p>
          <Button
            onClick={onCreate}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          >
            Create Your First Event
          </Button>
        </Card>
      ) : (
        <div className="bg-card rounded-lg shadow-xl border-2 border-border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
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
              {events.map((event) => (
                <TableRow key={event.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium text-foreground">
                    {event.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.description || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {event.endDate ? (
                      <ClientEventLocalDate value={event.endDate} includeTime />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${event.isActive ? "bg-green-100 dark:bg-green-950/60 text-green-800" : "bg-muted text-foreground"}`}
                    >
                      {event.isActive ? "Active" : "Disabled"}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event._count.accessRequests}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    <ClientEventLocalDate value={event.createdAt} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(event)}
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 hover:bg-blue-50 dark:bg-blue-950/40"
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggle(event)}
                        className={
                          event.isActive
                            ? "text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 hover:bg-yellow-50 dark:bg-yellow-950/40"
                            : "text-green-600 dark:text-green-400 hover:text-green-800 hover:bg-green-50 dark:bg-green-950/40"
                        }
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
                        onClick={() => onDelete(event.id)}
                        className="text-red-600 dark:text-red-400 hover:text-red-800 hover:bg-red-50 dark:bg-red-950/40"
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
    </>
  );
}
