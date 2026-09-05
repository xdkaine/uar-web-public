export interface DirectoryPerson {
  username: string;
  displayName: string;
  email: string;
}

export interface MemberPickerState {
  query: string;
  selectedPeople: DirectoryPerson[];
  open: boolean;
}

export type MemberPickerAction =
  | { type: 'query'; value: string }
  | { type: 'select'; person: DirectoryPerson }
  | { type: 'remove'; username: string }
  | { type: 'close' }
  | { type: 'reset' };

export const initialMemberPickerState: MemberPickerState = {
  query: '',
  selectedPeople: [],
  open: false,
};

export function memberPickerReducer(
  state: MemberPickerState,
  action: MemberPickerAction,
): MemberPickerState {
  switch (action.type) {
    case 'query':
      return { ...state, query: action.value, open: Boolean(action.value.trim()) };
    case 'select': {
      const normalizedUsername = action.person.username.toLowerCase();
      const alreadySelected = state.selectedPeople.some(
        (person) => person.username.toLowerCase() === normalizedUsername,
      );
      return {
        query: '',
        selectedPeople: alreadySelected
          ? state.selectedPeople
          : [...state.selectedPeople, action.person],
        open: false,
      };
    }
    case 'remove': {
      const normalizedUsername = action.username.toLowerCase();
      return {
        ...state,
        selectedPeople: state.selectedPeople.filter(
          (person) => person.username.toLowerCase() !== normalizedUsername,
        ),
      };
    }
    case 'close':
      return { ...state, open: false };
    case 'reset':
      return initialMemberPickerState;
  }
}

export function filterDirectoryPeople({
  directoryPeople,
  currentUsernames,
  selectedPeople,
  query,
  limit = 8,
}: {
  directoryPeople: DirectoryPerson[];
  currentUsernames: string[];
  selectedPeople: DirectoryPerson[];
  query: string;
  limit?: number;
}): DirectoryPerson[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const unavailableUsernames = new Set([
    ...currentUsernames.map((username) => username.toLowerCase()),
    ...selectedPeople.map((person) => person.username.toLowerCase()),
  ]);

  return directoryPeople.filter((person) => (
    !unavailableUsernames.has(person.username.toLowerCase())
    && [person.username, person.displayName, person.email]
      .some((value) => value.toLowerCase().includes(normalizedQuery))
  )).slice(0, limit);
}
