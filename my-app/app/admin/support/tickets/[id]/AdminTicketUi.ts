export function getSeverityColor(severity: string | null) {
  if (!severity) return 'bg-muted text-foreground';
  switch (severity) {
    case 'critical': return 'bg-red-100 dark:bg-red-950/60 text-red-800';
    case 'high': return 'bg-orange-100 dark:bg-orange-950/60 text-orange-800';
    case 'medium': return 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800';
    case 'low': return 'bg-green-100 dark:bg-green-950/60 text-green-800';
    default: return 'bg-muted text-foreground';
  }
}

export function getStatusColor(status: string) {
  switch (status) {
    case 'open': return 'bg-blue-100 dark:bg-blue-950/60 text-blue-800';
    case 'in_progress': return 'bg-purple-100 dark:bg-purple-950/60 text-purple-800';
    default: return 'bg-muted text-foreground';
  }
}

export function formatStatus(status: string) {
  return status.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
