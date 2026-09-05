interface PasswordResetSubmitButtonProps {
  loading: boolean;
  label: string;
}

export function PasswordResetSubmitButton({
  loading,
  label,
}: PasswordResetSubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full py-2.5 sm:py-3 px-4 sm:px-6 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-semibold rounded-lg transition-colors duration-200 flex items-center justify-center gap-2 text-sm sm:text-base"
    >
      {loading ? (
        <>
          <svg
            className="animate-spin h-5 w-5 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          Sending...
        </>
      ) : (
        <>
          {label}
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
              d="M13 7l5 5m0 0l-5 5m5-5H6"
            />
          </svg>
        </>
      )}
    </button>
  );
}
