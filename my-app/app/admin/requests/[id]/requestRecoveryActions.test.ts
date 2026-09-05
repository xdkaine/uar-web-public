import { describe, expect, it } from "vitest";
import { buildWorkflowReconciliationBody } from "./useRequestRecoveryActions";
import type { AccessRequest } from "./RequestDetailTypes";

describe("buildWorkflowReconciliationBody", () => {
  it("preserves the request workflow CAS evidence and raw reconciliation reason", () => {
    const request = {
      id: "request-1",
      version: 42,
      workflowVersionId: null,
      status: "pending_faculty",
    } as AccessRequest;

    expect(
      buildWorkflowReconciliationBody(
        request,
        "workflow-9",
        "  reviewed operator evidence  ",
      ),
    ).toEqual({
      targetWorkflowDefinitionId: "workflow-9",
      expectedRequestVersion: 42,
      expectedWorkflowVersionId: null,
      expectedStatus: "pending_faculty",
      reason: "  reviewed operator evidence  ",
    });
  });
});
