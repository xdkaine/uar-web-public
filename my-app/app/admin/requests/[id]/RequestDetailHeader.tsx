import type { AccessRequest, RequestReview } from "./RequestDetailTypes";

interface RequestDetailHeaderProps {
  request: AccessRequest;
  review: RequestReview | null;
  onBack: () => void;
}

const statusClasses: Record<string, string> = {
  pending_verification: "bg-muted text-foreground",
  pending_student_directors:
    "bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200",
  pending_faculty:
    "bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-200",
  approved:
    "bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-200",
  offboarded:
    "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700",
};

function getStatusLabel(request: AccessRequest, review: RequestReview | null) {
  if (review?.currentStage?.label) return review.currentStage.label;
  if (request.status === "pending_verification") return "Pending Verification";
  if (request.status === "pending_student_directors")
    return "Pending Directors";
  if (request.status === "pending_faculty") return "Pending Faculty";
  if (request.status === "offboarded") return "Offboarded";
  return request.status.charAt(0).toUpperCase() + request.status.slice(1);
}

export default function RequestDetailHeader({
  request,
  review,
  onBack,
}: RequestDetailHeaderProps) {
  return (
    <>
      <button
        onClick={onBack}
        className="text-muted-foreground hover:text-foreground hover:underline mb-4 sm:mb-6 flex items-center gap-2 font-medium text-sm sm:text-base"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back to Dashboard
      </button>
      <div className="flex flex-col sm:flex-row justify-between items-start mb-4 sm:mb-6 gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground mb-2">
            Access Request Details
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground break-all">
            Request ID: {request.id}
          </p>
        </div>
        <span
          className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap ${statusClasses[request.status] ?? "bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-200"}`}
        >
          {getStatusLabel(request, review)}
        </span>
      </div>
    </>
  );
}
