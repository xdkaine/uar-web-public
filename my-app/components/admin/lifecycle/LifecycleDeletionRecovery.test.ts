import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import LifecycleDeletionRecovery from "./LifecycleDeletionRecovery";
import { isUnfinishedDeletion } from "./lifecycleDeletionRecoveryUtils";

const fetchWithCsrf = vi.hoisted(() => vi.fn());
vi.mock("@/lib/csrf", () => ({ fetchWithCsrf }));

describe("interrupted deletion recovery", () => {
  it("remains on demand without fetching or showing a plan dashboard when closed", () => {
    const html = renderToStaticMarkup(
      createElement(LifecycleDeletionRecovery, { onRecovered: vi.fn() }),
    );
    expect(html).toContain("Interrupted deletions");
    expect(html).not.toContain("Finalize recorded outcomes");
    expect(fetchWithCsrf).not.toHaveBeenCalled();
  });

  it.each(["processing", "reconciliation_required"])(
    "keeps %s plans discoverable even with zero children",
    (status) => {
      expect(isUnfinishedDeletion({ status, ...{ recordedActions: 0 } })).toBe(
        true,
      );
    },
  );

  it.each(["completed", "failed", "partial"])(
    "does not clutter recovery with terminal %s plans",
    (status) => {
      expect(isUnfinishedDeletion({ status })).toBe(false);
    },
  );
});
