'use client';

import { useState, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/useToast';
import { fetchWithCsrf } from '@/lib/csrf';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  Users, 
  Trash2, 
  Search, 
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Group {
  dn: string;
  name: string;
  description: string;
}

interface GroupMember {
  dn: string;
  username: string;
  displayName: string;
}

interface GroupManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function GroupManagementModal({ isOpen, onClose }: GroupManagementModalProps) {
  const { showToast } = useToast();

  // Group Search State
  const [groupQuery, setGroupQuery] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  // Members State
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);

  // Add Member State
  const [addMemberQuery, setAddMemberQuery] = useState('');
  const [availableUsers, setAvailableUsers] = useState<string[]>([]);
  const [showUserSuggestions, setShowUserSuggestions] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const autocompleteRef = useRef<HTMLFormElement>(null);

  // Remove Member State
  const [memberToRemove, setMemberToRemove] = useState<string | null>(null);

  // A modal can close or reopen while these directory queries are in flight.
  // Keep only the response that belongs to this open instance.
  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();
    let current = true;

    const loadUsers = async () => {
      try {
        const res = await fetchWithCsrf('/api/admin/users', { signal: controller.signal });
        if (!res.ok || !current) return;
        const data: { users: Array<{ username?: string | null; dn?: string | null }> } = await res.json();
        if (!current) return;

        const usernames: string[] = [];
        for (const user of data.users) {
          if (user.dn && typeof user.username === 'string' && user.username) {
            usernames.push(user.username);
          }
        }
        setAvailableUsers(usernames);
      } catch (error) {
        if (!controller.signal.aborted) console.error('Error fetching users:', error);
      }
    };

    const loadGroups = async () => {
      setIsLoadingGroups(true);
      try {
        const res = await fetchWithCsrf('/api/admin/groups', { signal: controller.signal });
        if (!res.ok || !current) return;
        const data = await res.json();
        if (current) setGroups(data.groups || []);
      } catch (error) {
        if (!controller.signal.aborted && current) {
          console.error('Error fetching groups:', error);
          showToast('Failed to fetch groups', 'error');
        }
      } finally {
        if (current) setIsLoadingGroups(false);
      }
    };

    void loadUsers();
    void loadGroups();
    return () => {
      current = false;
      controller.abort();
    };
  }, [isOpen, showToast]);

  // Click outside listener for autocomplete
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(event.target as Node)) {
        setShowUserSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const fetchMembers = async (groupName: string) => {
    setIsLoadingMembers(true);
    try {
      const res = await fetchWithCsrf(`/api/admin/groups/${encodeURIComponent(groupName)}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      } else {
        showToast('Failed to fetch members', 'error');
      }
    } catch (error) {
      console.error('Error fetching members:', error);
      showToast('Failed to fetch members', 'error');
    } finally {
      setIsLoadingMembers(false);
    }
  };

  const handleGroupSelect = (group: Group) => {
    setSelectedGroup(group);
    setMembers([]);
    fetchMembers(group.name);
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup || !addMemberQuery) return;

    setIsAddingMember(true);
    try {
      const res = await fetchWithCsrf(`/api/admin/groups/${encodeURIComponent(selectedGroup.name)}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: addMemberQuery }),
      });

      if (res.ok) {
        showToast(`Added ${addMemberQuery} to ${selectedGroup.name}`, 'success');
        setAddMemberQuery('');
        fetchMembers(selectedGroup.name);
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to add member', 'error');
      }
    } catch (error) {
      console.error('Error adding member:', error);
      showToast('Failed to add member', 'error');
    } finally {
      setIsAddingMember(false);
    }
  };

  const confirmRemoveMember = async () => {
    if (!selectedGroup || !memberToRemove) return;

    try {
      const res = await fetchWithCsrf(`/api/admin/groups/${encodeURIComponent(selectedGroup.name)}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: memberToRemove }),
      });

      if (res.ok) {
        showToast(`Removed ${memberToRemove} from ${selectedGroup.name}`, 'success');
        fetchMembers(selectedGroup.name);
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to remove member', 'error');
      }
    } catch (error) {
      console.error('Error removing member:', error);
      showToast('Failed to remove member', 'error');
    } finally {
      setMemberToRemove(null);
    }
  };

  const filteredUsers = availableUsers
    .filter(u => u.toLowerCase().includes(addMemberQuery.toLowerCase()))
    .slice(0, 10);

  const filteredGroups = groups.filter(g => 
    g.name.toLowerCase().includes(groupQuery.toLowerCase()) || 
    (g.description && g.description.toLowerCase().includes(groupQuery.toLowerCase()))
  );

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent size="wide" className="flex flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4 pr-12 sm:px-6">
            <DialogTitle className="flex items-center gap-2">
               <Users className="w-5 h-5" /> Manage AD Groups
            </DialogTitle>
            <DialogDescription>
              Select a directory group to review membership or add a user.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] md:overflow-hidden">
            <div className="flex min-h-64 flex-col border-b bg-muted/10 md:min-h-0 md:border-b-0 md:border-r">
              <div className="p-4 border-b space-y-3">
                 <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Groups</h3>
                 <div className="relative">
                    <Input
                      value={groupQuery}
                      onChange={(e) => setGroupQuery(e.target.value)}
                      placeholder="Search groups..."
                      className="pl-8 bg-card"
                    />
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                 </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {isLoadingGroups ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">Loading groups...</div>
                ) : filteredGroups.length > 0 ? (
                  filteredGroups.map((group) => (
                    <Button
                      key={group.dn || `group-${group.name}`}
                      variant="ghost"
                      onClick={() => handleGroupSelect(group)}
                      className={cn(
                        "relative block h-auto w-full justify-start border border-transparent px-3 py-3 text-left",
                        selectedGroup?.dn === group.dn
                          ? 'border-blue-200 bg-card shadow-sm ring-1 ring-blue-100 dark:border-blue-900 dark:ring-blue-900'
                          : 'hover:bg-card hover:shadow-sm'
                      )}
                    >
                      <div className={cn("font-medium truncate", selectedGroup?.dn === group.dn ? 'text-blue-700 dark:text-blue-200' : 'text-foreground')}>{group.name}</div>
                      {group.description && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5 font-normal">{group.description}</div>
                      )}
                    </Button>
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    {groupQuery ? 'No matching groups' : 'No groups available'}
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-[24rem] min-w-0 flex-col bg-card md:min-h-0">
              {selectedGroup ? (
                <>
                  <div className="p-6 pb-4 border-b bg-muted/5">
                    <div className="mb-4 flex min-w-0 items-center gap-3">
                       <span className="p-2 bg-blue-100 dark:bg-blue-950/60 rounded-lg text-blue-700 dark:text-blue-200">
                          <Users className="w-5 h-5" />
                       </span>
                       <div className="min-w-0">
                          <h3 className="truncate text-lg font-bold" title={selectedGroup.name}>{selectedGroup.name}</h3>
                          {selectedGroup.description && (
                             <p className="line-clamp-2 text-sm text-muted-foreground" title={selectedGroup.description}>{selectedGroup.description}</p>
                          )}
                       </div>
                    </div>

                    <form onSubmit={handleAddMember} className="relative" ref={autocompleteRef}>
                       <div className="flex flex-col gap-2 sm:flex-row">
                          <div className="flex-1 relative">
                             <Input
                                value={addMemberQuery}
                                onChange={(e) => {
                                   setAddMemberQuery(e.target.value);
                                   setShowUserSuggestions(true);
                                }}
                                onFocus={() => setShowUserSuggestions(true)}
                                placeholder="Search by username…"
                             />
                             {showUserSuggestions && addMemberQuery && filteredUsers.length > 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-card border rounded-md shadow-lg max-h-40 overflow-y-auto">
                                   {filteredUsers.map((user) => (
                                      <button
                                         key={user}
                                         type="button"
                                         onClick={() => {
                                            setAddMemberQuery(user);
                                            setShowUserSuggestions(false);
                                         }}
                                         className="w-full text-left px-4 py-2 hover:bg-muted text-sm"
                                      >
                                         {user}
                                      </button>
                                   ))}
                                </div>
                             )}
                          </div>
                          <Button 
                             type="submit" 
                             disabled={isAddingMember || !addMemberQuery}
                             className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
                          >
                             {isAddingMember ? 'Adding...' : 'Add Member'}
                          </Button>
                       </div>
                    </form>
                  </div>

                  <div className="flex-1 overflow-y-auto p-0">
                    {isLoadingMembers ? (
                      <div className="text-center py-12 text-muted-foreground">Loading members...</div>
                    ) : members.length > 0 ? (
                      <Table>
                        <TableHeader className="bg-muted/5 sticky top-0">
                          <TableRow>
                            <TableHead className="w-[40%]">Display Name</TableHead>
                            <TableHead className="w-[40%]">Username</TableHead>
                            <TableHead className="w-[20%] text-right">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {members.map((member) => (
                            <TableRow key={member.dn}>
                              <TableCell className="font-medium">{member.displayName}</TableCell>
                              <TableCell className="text-muted-foreground">{member.username}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setMemberToRemove(member.username)}
                                  className="text-red-600 hover:text-red-700 dark:hover:text-red-200 dark:text-red-200 hover:bg-red-50 dark:bg-red-950/40 h-8 px-2"
                                  aria-label={`Remove ${member.username} from ${selectedGroup.name}`}
                                  title={`Remove ${member.username}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
                         <div className="p-3 bg-muted rounded-full">
                            <Users className="w-6 h-6 opacity-20" />
                         </div>
                         <p>No members in this group</p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
                   <div className="p-4 bg-muted/20 rounded-full border-2 border-dashed border-border">
                      <Search className="w-8 h-8 opacity-20" />
                   </div>
                   <p className="font-medium">Select a group to manage members</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!memberToRemove} onOpenChange={(open) => !open && setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove User from Group?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{memberToRemove}</strong> from <strong>{selectedGroup?.name}</strong>?
              This action cannot be undone immediately, but you can add them back later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmRemoveMember}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Remove Member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
