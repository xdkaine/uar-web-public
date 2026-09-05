import { describe, expect, it } from 'vitest';

import {
  filterDirectoryPeople,
  memberPickerReducer,
  type DirectoryPerson,
  type MemberPickerState,
} from './lifecycleGroupSelection';

const jordan: DirectoryPerson = {
  username: 'jlee',
  displayName: 'Jordan Lee',
  email: 'jlee@example.test',
};

const alex: DirectoryPerson = {
  username: 'arivera',
  displayName: 'Alex Rivera',
  email: 'arivera@example.test',
};

const emptyState: MemberPickerState = {
  query: '',
  selectedPeople: [],
  open: false,
};

describe('lifecycle group member picker', () => {
  it('closes the suggestion menu and clears the query after a person is selected', () => {
    const searching = memberPickerReducer(emptyState, { type: 'query', value: 'Jordan' });
    const selected = memberPickerReducer(searching, { type: 'select', person: jordan });

    expect(searching.open).toBe(true);
    expect(selected).toEqual({
      query: '',
      selectedPeople: [jordan],
      open: false,
    });
  });

  it('supports multiple unique selections and removing one by username', () => {
    const withJordan = memberPickerReducer(emptyState, { type: 'select', person: jordan });
    const withBoth = memberPickerReducer(withJordan, { type: 'select', person: alex });
    const withoutJordan = memberPickerReducer(withBoth, { type: 'remove', username: 'JLEE' });

    expect(withBoth.selectedPeople).toEqual([jordan, alex]);
    expect(memberPickerReducer(withBoth, { type: 'select', person: { ...jordan, username: 'JLEE' } }).selectedPeople).toEqual([jordan, alex]);
    expect(withoutJordan.selectedPeople).toEqual([alex]);
  });

  it('does not suggest current or already-selected group members', () => {
    expect(filterDirectoryPeople({
      directoryPeople: [jordan, alex],
      currentUsernames: ['arivera'],
      selectedPeople: [jordan],
      query: 'a',
    })).toEqual([]);
  });
});
