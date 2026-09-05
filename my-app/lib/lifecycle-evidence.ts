export function redactLifecycleExceptionEvidence<T extends Record<string, unknown>>(
  action: T,
  canViewExceptionEvidence: boolean
): T {
  if (canViewExceptionEvidence) return action;
  return {
    ...action,
    authorizationEvidence: null,
    preflightSnapshot: null,
    resultSnapshot: null,
    targetDirectoryDn: null,
    targetDirectoryObjectGuid: null,
  };
}
