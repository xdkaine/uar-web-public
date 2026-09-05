export function isUnfinishedDeletion(plan: { status: string }): boolean {
  return (
    plan.status === "processing" || plan.status === "reconciliation_required"
  );
}
