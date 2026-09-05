import type { ADSearchResult, ImportRecord } from "./vpnADMatchTypes";

export interface VPNMatchDraft {
  selectedRecord: ImportRecord | null;
  adSearchQuery: string;
  adSearchResults: ADSearchResult[];
  isSearching: boolean;
  matchNotes: string;
}

export const initialVPNMatchDraft: VPNMatchDraft = {
  selectedRecord: null,
  adSearchQuery: "",
  adSearchResults: [],
  isSearching: false,
  matchNotes: "",
};

type DraftAction =
  | { type: "recordSelected"; record: ImportRecord }
  | { type: "queryEdited"; query: string }
  | { type: "notesEdited"; notes: string }
  | { type: "searchStarted" }
  | { type: "searchSucceeded"; results: ADSearchResult[] }
  | { type: "searchFailed" }
  | { type: "cleared" };

export function vpnMatchDraftReducer(
  state: VPNMatchDraft,
  action: DraftAction,
): VPNMatchDraft {
  switch (action.type) {
    case "recordSelected":
      return {
        ...initialVPNMatchDraft,
        selectedRecord: action.record,
        adSearchQuery: action.record.vpnUsername,
      };
    case "queryEdited":
      return {
        ...state,
        adSearchQuery: action.query,
        adSearchResults: [],
        isSearching: false,
      };
    case "notesEdited":
      return { ...state, matchNotes: action.notes };
    case "searchStarted":
      return { ...state, adSearchResults: [], isSearching: true };
    case "searchSucceeded":
      return { ...state, adSearchResults: action.results, isSearching: false };
    case "searchFailed":
      return { ...state, isSearching: false };
    case "cleared":
      return initialVPNMatchDraft;
  }
}
