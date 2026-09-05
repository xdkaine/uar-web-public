import { describe, expect, it } from "vitest";
import { initialVPNMatchDraft, vpnMatchDraftReducer } from "./vpnMatchDraft";

const record = {
  id: "record-a",
  vpnUsername: "vpn.a",
  matchStatus: "unmatched",
};

describe("VPN matching draft ownership", () => {
  it("selects a record with a fresh query, results and notes", () => {
    expect(
      vpnMatchDraftReducer(
        {
          ...initialVPNMatchDraft,
          matchNotes: "old notes",
          isSearching: true,
          adSearchResults: [{ username: "old.ad" }],
        },
        { type: "recordSelected", record },
      ),
    ).toEqual({
      ...initialVPNMatchDraft,
      selectedRecord: record,
      adSearchQuery: "vpn.a",
    });
  });
  it("invalidates prior results when query text changes but retains record notes", () => {
    expect(
      vpnMatchDraftReducer(
        {
          ...initialVPNMatchDraft,
          selectedRecord: record,
          matchNotes: "  raw evidence  ",
          isSearching: true,
          adSearchResults: [{ username: "old.ad" }],
        },
        { type: "queryEdited", query: "new.ad" },
      ),
    ).toEqual({
      ...initialVPNMatchDraft,
      selectedRecord: record,
      matchNotes: "  raw evidence  ",
      adSearchQuery: "new.ad",
    });
  });
  it("keeps raw notes and selection after a failed search", () => {
    const state = {
      ...initialVPNMatchDraft,
      selectedRecord: record,
      matchNotes: "  raw evidence  ",
      isSearching: true,
    };
    expect(vpnMatchDraftReducer(state, { type: "searchFailed" })).toEqual({
      ...state,
      isSearching: false,
    });
  });
  it("clears results before starting a new search and accepts its completion", () => {
    const started = vpnMatchDraftReducer(
      { ...initialVPNMatchDraft, adSearchResults: [{ username: "old.ad" }] },
      { type: "searchStarted" },
    );
    expect(started).toEqual({ ...initialVPNMatchDraft, isSearching: true });
    expect(
      vpnMatchDraftReducer(started, {
        type: "searchSucceeded",
        results: [{ username: "new.ad" }],
      }),
    ).toEqual({
      ...initialVPNMatchDraft,
      adSearchResults: [{ username: "new.ad" }],
    });
  });
  it("clears the entire draft after cancellation or confirmed matching", () => {
    expect(
      vpnMatchDraftReducer(
        {
          ...initialVPNMatchDraft,
          selectedRecord: record,
          matchNotes: "notes",
        },
        { type: "cleared" },
      ),
    ).toEqual(initialVPNMatchDraft);
  });
});
