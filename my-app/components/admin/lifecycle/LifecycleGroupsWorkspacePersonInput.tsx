import type { Dispatch, KeyboardEvent, SetStateAction } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type {
  DirectoryPerson,
  MemberPickerAction,
  MemberPickerState,
} from "./lifecycleGroupSelection";

interface LifecycleGroupsWorkspacePersonInputProps {
  picker: MemberPickerState;
  suggestions: DirectoryPerson[];
  suggestionsOpen: boolean;
  activeSuggestion: number;
  disabled: boolean;
  dispatchPicker: Dispatch<MemberPickerAction>;
  onActiveSuggestionChange: Dispatch<SetStateAction<number>>;
}

function moveSuggestion(current: number, key: string, count: number) {
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  return current < 0 ? count - 1 : (current - 1 + count) % count;
}

export function LifecycleGroupsWorkspacePersonInput({
  picker,
  suggestions,
  suggestionsOpen,
  activeSuggestion,
  disabled,
  dispatchPicker,
  onActiveSuggestionChange,
}: LifecycleGroupsWorkspacePersonInputProps) {
  const selectSuggestion = (person: DirectoryPerson | undefined) => {
    if (person) dispatchPicker({ type: "select", person });
    onActiveSuggestionChange(-1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dispatchPicker({ type: "close" });
    } else if (suggestions.length > 0 && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      dispatchPicker({ type: "query", value: picker.query });
      onActiveSuggestionChange((current) => moveSuggestion(current, event.key, suggestions.length));
    } else if (event.key === "Enter" && suggestionsOpen) {
      event.preventDefault();
      selectSuggestion(suggestions[Math.max(0, Math.min(activeSuggestion, suggestions.length - 1))]);
    }
  };

  return (
    <div className="relative min-w-0 flex-1" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dispatchPicker({ type: "close" });
    }}>
      <Input
        id="group-user" role="combobox" aria-autocomplete="list" aria-expanded={suggestionsOpen}
        aria-controls={suggestionsOpen ? "group-user-options" : undefined}
        aria-activedescendant={suggestionsOpen && activeSuggestion >= 0 ? `group-user-option-${activeSuggestion}` : undefined}
        aria-describedby="group-user-help" autoComplete="off" value={picker.query}
        onFocus={() => dispatchPicker({ type: "query", value: picker.query })}
        onChange={(event) => { onActiveSuggestionChange(-1); dispatchPicker({ type: "query", value: event.target.value }); }}
        onKeyDown={handleKeyDown} placeholder="Search by name, username, or email" disabled={disabled}
      />
      {suggestionsOpen && <div id="group-user-options" role="listbox" aria-label="Matching accounts" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
        {suggestions.map((person, index) => <button key={person.username} id={`group-user-option-${index}`} type="button" role="option" aria-selected={index === activeSuggestion} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => selectSuggestion(person)} className={cn("block w-full rounded px-3 py-2 text-left hover:bg-accent", index === activeSuggestion && "bg-accent")}>
          <span className="block text-sm font-medium">{person.displayName}</span>
          <span className="block break-all text-xs text-muted-foreground">{person.username}{person.email ? ` · ${person.email}` : ""}</span>
        </button>)}
      </div>}
    </div>
  );
}
