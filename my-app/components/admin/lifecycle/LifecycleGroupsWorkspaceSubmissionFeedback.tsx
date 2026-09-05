import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface SubmissionIssue {
  operation: "add" | "remove";
  username: string;
  message: string;
  requiresReview: boolean;
}

interface LifecycleGroupsWorkspaceSubmissionFeedbackProps {
  summary: string;
  requiresReview: boolean;
  reviewUsernames: string[];
  issue: SubmissionIssue | null;
}

function issueNextStep(issue: SubmissionIssue) {
  if (issue.requiresReview) return " Resolve this account’s outcome in Operations, then reload this page before retrying.";
  return issue.operation === "add"
    ? " Correct the issue before submitting the remaining selection."
    : " Correct the issue before attempting removal again.";
}

export function LifecycleGroupsWorkspaceSubmissionFeedback({
  summary,
  requiresReview,
  reviewUsernames,
  issue,
}: LifecycleGroupsWorkspaceSubmissionFeedbackProps) {
  return (
    <>
      {summary && <p role="status" className="text-sm font-medium">{summary}</p>}
      {requiresReview && <p role="alert" className="text-sm text-destructive">Review required for {reviewUsernames.join(", ")}. Resolve the outcome in Operations, then reload this page before retrying. Remove these accounts from the selection to continue with the others.</p>}
      {issue && <Alert variant="destructive"><AlertTitle>Change for {issue.username} was not confirmed</AlertTitle><AlertDescription>{issue.message}{issueNextStep(issue)}</AlertDescription></Alert>}
    </>
  );
}
