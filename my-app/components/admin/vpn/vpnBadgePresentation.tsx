import { Badge } from "@/components/ui/badge";

export const getStatusBadge = (status: string) => {
  const styles = {
    active:
      "bg-green-100 dark:bg-green-950/60 text-green-800 border-green-300 hover:bg-green-100 dark:bg-green-950/60",
    pending_faculty:
      "bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 border-yellow-300 hover:bg-yellow-100 dark:bg-yellow-950/60",
    disabled:
      "bg-red-100 dark:bg-red-950/60 text-red-800 border-red-300 hover:bg-red-100 dark:bg-red-950/60",
    revoked:
      "bg-purple-100 dark:bg-purple-950/60 text-purple-800 border-purple-300 hover:bg-purple-100 dark:bg-purple-950/60",
  };

  const labels = {
    active: "Active",
    pending_faculty: "Pending Faculty",
    disabled: "Disabled",
    revoked: "Revoked",
  };

  return (
    <Badge
      variant="outline"
      className={
        styles[status as keyof typeof styles] ||
        "bg-muted text-foreground border-border"
      }
    >
      {labels[status as keyof typeof labels] || status}
    </Badge>
  );
};

export const getPortalBadge = (portalType: string) => {
  const styles = {
    Management:
      "bg-blue-100 dark:bg-blue-950/60 text-blue-800 border-blue-300 hover:bg-blue-100 dark:bg-blue-950/60",
    Limited:
      "bg-purple-100 dark:bg-purple-950/60 text-purple-800 border-purple-300 hover:bg-purple-100 dark:bg-purple-950/60",
    External:
      "bg-orange-100 dark:bg-orange-950/60 text-orange-800 border-orange-300 hover:bg-orange-100 dark:bg-orange-950/60",
  };

  return (
    <Badge
      variant="outline"
      className={
        styles[portalType as keyof typeof styles] ||
        "bg-muted text-foreground border-border"
      }
    >
      {portalType}
    </Badge>
  );
};
