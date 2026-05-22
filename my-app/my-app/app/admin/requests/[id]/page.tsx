'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Toast from '@/components/Toast';
import DateTimePicker from '@/components/DateTimePicker';
import { useToast } from '@/hooks/useToast';
import { fetchWithCsrf } from '@/lib/csrf';
import { useAdminPageTracking } from '@/hooks/useAdminPageTracking';

interface AccessRequest {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  email: string;
  isInternal: boolean;
  needsDomainAccount: boolean;
  institution?: string;
  eventReason?: string;
  eventId?: string;
  event?: {
    id: string;
    name: string;
    description?: string;
    endDate?: string;
  };
  accessEndTime?: string;
  isVerified: boolean;
  verificationToken?: string;
  verifiedAt?: string;
  status: string;
  acknowledgedByDirector: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  approvalMessage?: string;
  ldapUsername?: string;
  vpnUsername?: string;
  accountPassword?: string;
  accountCreatedAt?: string;
  accountExpiresAt?: string;
  sentToFacultyAt?: string;
  sentToFacultyBy?: string;
  rejectionReason?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  isManuallyAssigned?: boolean;
  manuallyAssignedAt?: string;
  manuallyAssignedBy?: string;
  linkedAdUsername?: string;
  linkedVpnUsername?: string;
  manualAssignmentNotes?: string;
  isGrandfatheredAccount?: boolean;
}

interface RequestComment {
  id: string;
  createdAt: string;
  updatedAt: string;
  comment: string;
  author: string;
  type?: string; // 'rejection' or undefined for normal comments
}

export default function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  useAdminPageTracking(`Access Request Detail - ${resolvedParams.id}`, 'access_request');
  const [request, setRequest] = useState<AccessRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [ldapUsername, setLdapUsername] = useState('');
  const [vpnUsername, setVpnUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usernameCheckMessage, setUsernameCheckMessage] = useState('');
  const [expirationDateTime, setExpirationDateTime] = useState(''); // ISO datetime string (YYYY-MM-DDTHH:mm)
  const [showPassword, setShowPassword] = useState(false);
  const [showFacultyMessage, setShowFacultyMessage] = useState(false);

  // Modal states
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'standard' | 'username-mismatch';
  } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [approvalMessage, setApprovalMessage] = useState('');

  // Manual assignment states
  const [showManualAssignModal, setShowManualAssignModal] = useState(false);
  const [linkedAdUsername, setLinkedAdUsername] = useState('');
  const [linkedVpnUsername, setLinkedVpnUsername] = useState('');
  const [manualAssignmentNotes, setManualAssignmentNotes] = useState('');
  const [adUsernameCheckMessage, setAdUsernameCheckMessage] = useState('');
  const [vpnUsernameCheckMessage, setVpnUsernameCheckMessage] = useState('');

  // Comments state
  const [comments, setComments] = useState<RequestComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [showCommentsSection, setShowCommentsSection] = useState(false);

  const { toast, showToast, hideToast } = useToast();
  const router = useRouter();

  const fetchComments = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/requests/${resolvedParams.id}/comments`);
      if (response.ok) {
        const data = await response.json();
        setComments(data.comments);
      }
    } catch (err) {
      console.error('Error fetching comments:', err);
    }
  }, [resolvedParams.id]);

  const fetchRequest = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/requests/${resolvedParams.id}`);

      if (response.status === 401 || response.status === 403) {
        // Redirect to login with the current page as the return URL
        const currentPath = `/admin/requests/${resolvedParams.id}`;
        router.push(`/login?redirect=${encodeURIComponent(currentPath)}`);
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch request');
      }

      const data = await response.json();
      setRequest(data.request);

      // Pre-fill linkedAdUsername for grandfathered accounts
      if (data.request.isGrandfatheredAccount && data.request.ldapUsername) {
        setLinkedAdUsername(data.request.ldapUsername);
      }

      // Pre-fill credentials if they exist (e.g., request was moved back)
      if (data.request.ldapUsername) {
        setLdapUsername(data.request.ldapUsername);
      } else if (data.request.isInternal) {
        setLdapUsername(data.request.email.split('@')[0]);
      } else {
        // For external users, use name without spaces
        const nameWithoutSpaces = data.request.name.replace(/\s+/g, '').toLowerCase();
        setLdapUsername(nameWithoutSpaces);
      }

      // Only set VPN username for external users
      if (!data.request.isInternal) {
        if (data.request.vpnUsername) {
          setVpnUsername(data.request.vpnUsername);
        } else {
          // For external users, use name without spaces
          const nameWithoutSpaces = data.request.name.replace(/\s+/g, '').toLowerCase();
          setVpnUsername(nameWithoutSpaces);
        }
      }

      if (data.request.accountPassword) {
        setPassword(data.request.accountPassword);
      }

      if (data.request.accountExpiresAt) {
        const expiresAt = new Date(data.request.accountExpiresAt);
        // Convert to local datetime string format (YYYY-MM-DDTHH:mm)
        const year = expiresAt.getFullYear();
        const month = String(expiresAt.getMonth() + 1).padStart(2, '0');
        const day = String(expiresAt.getDate()).padStart(2, '0');
        const hours = String(expiresAt.getHours()).padStart(2, '0');
        const minutes = String(expiresAt.getMinutes()).padStart(2, '0');
        setExpirationDateTime(`${year}-${month}-${day}T${hours}:${minutes}`);
      } else if (!data.request.isInternal) {
        // Default to accessEndTime if available, otherwise today at 23:59
        if (data.request.accessEndTime) {
          const accessEnd = new Date(data.request.accessEndTime);
          const year = accessEnd.getFullYear();
          const month = String(accessEnd.getMonth() + 1).padStart(2, '0');
          const day = String(accessEnd.getDate()).padStart(2, '0');
          const hours = String(accessEnd.getHours()).padStart(2, '0');
          const minutes = String(accessEnd.getMinutes()).padStart(2, '0');
          setExpirationDateTime(`${year}-${month}-${day}T${hours}:${minutes}`);
        } else {
          const today = new Date();
          const year = today.getFullYear();
          const month = String(today.getMonth() + 1).padStart(2, '0');
          const day = String(today.getDate()).padStart(2, '0');
          setExpirationDateTime(`${year}-${month}-${day}T23:59`);
        }
      }

      // Fetch comments
      fetchComments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [resolvedParams.id, router, fetchComments]);

  useEffect(() => {
    document.title = 'Request Details | User Access Request (UAR) Portal';
  }, []);

  useEffect(() => {
    fetchRequest();
  }, [fetchRequest]);

  const handleAddComment = async () => {
    if (!newComment.trim()) {
      showToast('Please enter a comment', 'warning');
      return;
    }

    try {
      const response = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: newComment }),
      });

      if (!response.ok) {
        throw new Error('Failed to add comment');
      }

      showToast('Comment added successfully', 'success');
      setNewComment('');
      fetchComments();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add comment', 'error');
    }
  };

  const checkUsernameAvailability = async (username: string) => {
    if (!username.trim()) {
      setUsernameCheckMessage('');
      return;
    }

    try {
      const response = await fetchWithCsrf('/api/admin/check-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, requestId: resolvedParams.id }),
      });

      const data = await response.json();
      setUsernameCheckMessage(data.message);
    } catch {
      setUsernameCheckMessage('Error checking username');
    }
  };

  // Call server-side password generator API
  const generatePassword = async () => {
    try {
      const response = await fetchWithCsrf('/api/admin/generate-password');

      if (!response.ok) {
        throw new Error('Failed to generate password');
      }

      const data = await response.json();
      setPassword(data.password);
    } catch (error) {
      showToast('Failed to generate password', 'error');
      console.error('Password generation error:', error);
    }
  };

  const handleCreateAccount = async () => {
    if (!ldapUsername.trim()) {
      showToast('Please enter an account username', 'warning');
      return;
    }

    // Only require VPN username for external users
    if (!request?.isInternal && !vpnUsername.trim()) {
      showToast('Please enter a VPN username for external users', 'warning');
      return;
    }

    if (!password.trim()) {
      showToast('Please enter or generate a password', 'warning');
      return;
    }

    if (!request?.isInternal && !expirationDateTime) {
      showToast('Please set an account disable date and time for external users', 'warning');
      return;
    }

    // Check if username is available before proceeding
    if (!usernameCheckMessage?.includes('available')) {
      showToast('Please check username availability first', 'warning');
      return;
    }

    setConfirmModalConfig({
      title: 'Create AD Account',
      message: `Are you sure you want to create the AD account for "${ldapUsername}"? This will create the account in Active Directory with the specified password.`,
      onConfirm: async () => {
        setShowConfirmModal(false);
        setActionLoading(true);
        setError('');

        try {
          // First, save the credentials to the database (without changing status)
          const requestBody: Record<string, string | null> = {
            ldapUsername,
            password,
            expirationDate: !request?.isInternal ? `${expirationDateTime}:00` : null,
          };

          // Only include VPN username for external users
          if (!request?.isInternal) {
            requestBody.vpnUsername = vpnUsername;
          }

          const saveResponse = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/save-credentials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          if (!saveResponse.ok) {
            const data = await saveResponse.json();
            throw new Error(data.error || 'Failed to save credentials');
          }

          // Then create the LDAP account
          const createResponse = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/create-account`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });

          if (!createResponse.ok) {
            const data = await createResponse.json();
            throw new Error(data.error || 'Failed to create an AD account');
          }

          const createData = await createResponse.json();
          showToast(createData.message || 'LDAP account created successfully and moved to Faculty Review!', 'success');

          // Redirect to admin page after successful creation
          setTimeout(() => router.push('/admin'), 2000);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to create account';
          showToast(message, 'error');
          setError(message);
        } finally {
          setActionLoading(false);
        }
      }
    });
    setShowConfirmModal(true);
  };

  const handleUpdateAccount = async () => {
    if (!ldapUsername.trim()) {
      showToast('Please enter an account username', 'warning');
      return;
    }

    // Only require VPN username for external users
    if (!request?.isInternal && !vpnUsername.trim()) {
      showToast('Please enter a VPN username for external users', 'warning');
      return;
    }

    if (!password.trim()) {
      showToast('Please enter or generate a password', 'warning');
      return;
    }

    if (!request?.isInternal && !expirationDateTime) {
      showToast('Please set an account disable date and time for external users', 'warning');
      return;
    }

    setConfirmModalConfig({
      title: 'Update LDAP Account',
      message: `Are you sure you want to update the LDAP account for "${ldapUsername}"? This will update the password and account disable date in Active Directory.`,
      onConfirm: async () => {
        setShowConfirmModal(false);
        setActionLoading(true);
        setError('');

        try {
          // IMPORTANT: Update LDAP account FIRST with old values from request object
          // THEN save new credentials to database
          const updateBody = {
            oldLdapUsername: request?.ldapUsername,
            oldVpnUsername: request?.vpnUsername,
            newLdapUsername: ldapUsername,
            newVpnUsername: vpnUsername,
            newPassword: password,
            newExpirationDate: !request?.isInternal ? `${expirationDateTime}:00` : null,
          };

          const updateResponse = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/update-account`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateBody),
          });

          if (!updateResponse.ok) {
            const data = await updateResponse.json();
            throw new Error(data.error || 'Failed to update LDAP account');
          }

          // Now save the new credentials to the database
          const requestBody: Record<string, string | null> = {
            ldapUsername,
            password,
            expirationDate: !request?.isInternal ? `${expirationDateTime}:00` : null,
          };

          // Only include VPN username for external users
          if (!request?.isInternal) {
            requestBody.vpnUsername = vpnUsername;
          }

          const saveResponse = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/save-credentials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          if (!saveResponse.ok) {
            const data = await saveResponse.json();
            throw new Error(data.error || 'Failed to save credentials');
          }

          const updateData = await updateResponse.json();
          showToast(updateData.message || 'LDAP account updated successfully!', 'success');

          // Refresh the request data
          await fetchRequest();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to update account';
          showToast(message, 'error');
          setError(message);
        } finally {
          setActionLoading(false);
        }
      }
    });
    setShowConfirmModal(true);
  };

  const handleApprove = async () => {
    setShowApproveModal(true);
  };

  const submitApproval = async () => {
    setShowApproveModal(false);
    setActionLoading(true);
    setError('');

    // Ensure a message is always provided for the approval comment
    const messageToSend = approvalMessage.trim() || 'Request approved.';

    try {
      const response = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: messageToSend }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to approve request');
      }

      showToast('Request approved successfully! User will receive an email notification.', 'success');
      setApprovalMessage('');

      // Refetch to get the updated comments (approval comment added by backend)
      await fetchRequest();

      setTimeout(() => router.push('/admin'), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve request';
      showToast(message, 'error');
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleNotifyFaculty = async () => {
    setActionLoading(true);
    setError('');

    try {
      const response = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/notify-faculty`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to mark as sent');
      }

      showToast('Marked as sent to faculty!', 'success');
      fetchRequest();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark as sent';
      showToast(message, 'error');
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const generateFacultyMessage = () => {
    if (!request) return '';

    const accountType = request.isInternal ? 'to verify access to the SDC VPN' : 'create a VPN account (vpn.sdc.cpp)';
    const expiresText = request.accountExpiresAt
      ? `\nAccount Disable Date: ${new Date(request.accountExpiresAt).toLocaleString()}`
      : '';

    const vpnLine = !request.isInternal && request.vpnUsername
      ? `\nVPN Username: ${request.vpnUsername}`
      : '';

    // For internal accounts, always show N/A for password
    // For external accounts, show the password or N/A if not set
    const passwordText = request.isInternal ? 'N/A' : (request.accountPassword || 'N/A');

    return `Hello!

I am requesting for you to ${accountType} with the following details:

Name: ${request.name}
Email: ${request.email}
${vpnLine}
Password: ${passwordText}${expiresText}

Please let me know once the account has been created.

Thank you!`;
  };

  const copyFacultyMessage = () => {
    const message = generateFacultyMessage();

    const textArea = document.createElement('textarea');
    textArea.value = message;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();

    try {
      document.execCommand('copy');
      showToast('Message copied to clipboard!', 'success');
    } catch {
      showToast('Failed to copy message. Please copy manually.', 'error');
    } finally {
      document.body.removeChild(textArea);
    }
  };

  const handleUndoNotifyFaculty = async () => {
    setConfirmModalConfig({
      title: 'Undo Sent to Faculty',
      message: 'Are you sure you want to undo the "Sent to Faculty" status?',
      onConfirm: async () => {
        setShowConfirmModal(false);
        setActionLoading(true);
        setError('');

        try {
          const response = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/undo-notify-faculty`, {
            method: 'POST',
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to undo notification');
          }

          showToast('Successfully undid "Sent to Faculty" status.', 'success');
          fetchRequest();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to undo notification';
          showToast(message, 'error');
          setError(message);
        } finally {
          setActionLoading(false);
        }
      }
    });
    setShowConfirmModal(true);
  };

  const handleMoveBack = async () => {
    setConfirmModalConfig({
      title: 'Move Back to Student Directors',
      message: 'Move this request back to Student Directors stage? The credentials will be preserved so they can be edited.',
      onConfirm: async () => {
        setShowConfirmModal(false);
        setActionLoading(true);
        setError('');

        try {
          const response = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/move-back`, {
            method: 'POST',
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to move request back');
          }

          const data = await response.json();
          showToast(data.message || 'Request moved back to Student Directors stage.', 'success');
          setTimeout(() => router.push('/admin'), 1500);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to move request back';
          showToast(message, 'error');
          setError(message);
        } finally {
          setActionLoading(false);
        }
      }
    });
    setShowConfirmModal(true);
  };

  const handleReturnToFaculty = async () => {
    setConfirmModalConfig({
      title: 'Return to Faculty Review',
      message: 'Are you sure you want to return this request to the Faculty Review stage? This will notify the faculty member.',
      onConfirm: async () => {
        setShowConfirmModal(false);
        setActionLoading(true);
        setError('');

        try {
          const response = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/return-to-faculty`, {
            method: 'POST',
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to return request to faculty');
          }

          const data = await response.json();
          showToast(data.message || 'Request returned to Faculty Review.', 'success');

          // Refresh data
          await fetchRequest();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to return request to faculty';
          showToast(message, 'error');
          setError(message);
        } finally {
          setActionLoading(false);
        }
      }
    });
    setShowConfirmModal(true);
  };

  const handleReject = async () => {
    setShowRejectModal(true);
  };

  const submitRejection = async () => {
    if (!rejectionReason.trim()) {
      showToast('Please provide a rejection reason', 'warning');
      return;
    }

    setShowRejectModal(false);
    setActionLoading(true);
    setError('');

    try {
      const response = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: rejectionReason }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to reject request');
      }

      showToast('Request rejected successfully. Notification email sent.', 'success');
      setRejectionReason('');

      // Refetch to get the updated comments (rejection comment added by backend)
      await fetchRequest();

      setTimeout(() => router.push('/admin'), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reject request';
      showToast(message, 'error');
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  // Manual Assignment Functions
  const checkAdUsernameExists = async (username: string) => {
    if (!username.trim()) {
      setAdUsernameCheckMessage('');
      return;
    }

    try {
      const response = await fetchWithCsrf('/api/admin/check-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, requestId: resolvedParams.id }),
      });

      const data = await response.json();
      setAdUsernameCheckMessage(data.message);
    } catch {
      setAdUsernameCheckMessage('Error checking username');
    }
  };

  const checkVpnUsernameExists = async (username: string) => {
    if (!username.trim()) {
      setVpnUsernameCheckMessage('');
      return;
    }

    try {
      const response = await fetchWithCsrf('/api/admin/check-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, requestId: resolvedParams.id }),
      });

      const data = await response.json();
      setVpnUsernameCheckMessage(data.message);
    } catch {
      setVpnUsernameCheckMessage('Error checking username');
    }
  };

  const handleManualAssign = async () => {
    setShowManualAssignModal(true);
  };

  const submitManualAssignment = async () => {
    // Prevent double submission
    if (actionLoading) {
      return;
    }

    if (!linkedAdUsername.trim()) {
      showToast('Please enter an Active Directory username', 'warning');
      return;
    }

    // Check if AD username exists
    if (!adUsernameCheckMessage?.includes('exists')) {
      showToast('Please verify the Active Directory username exists first', 'warning');
      return;
    }

    // For external users, check VPN username if provided
    if (!request?.isInternal && linkedVpnUsername.trim() && !vpnUsernameCheckMessage?.includes('exists')) {
      showToast('Please verify the VPN username exists first', 'warning');
      return;
    }

    setShowManualAssignModal(false);
    setActionLoading(true);
    setError('');

    try {
      const requestBody: {
        linkedAdUsername: string;
        notes: string | null;
        linkedVpnUsername?: string;
      } = {
        linkedAdUsername: linkedAdUsername.trim(),
        notes: manualAssignmentNotes.trim() || null,
      };

      // Only include VPN username for external users if provided
      if (!request?.isInternal && linkedVpnUsername.trim()) {
        requestBody.linkedVpnUsername = linkedVpnUsername.trim();
      }

      const response = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/manual-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const data = await response.json();

        // Check if this is a warning that requires confirmation (username mismatch)
        if (response.status === 409 && data.requiresConfirmation && data.warning) {
          // Show confirmation modal for username mismatch
          setActionLoading(false);
          setConfirmModalConfig({
            title: '⚠️ Username Mismatch Detected',
            message: `${data.error}\n\n${data.message}\n\nExpected username: ${data.suggestion}\nYou entered: ${data.providedUsername}\n\nAre you sure you want to proceed with this manual assignment?`,
            type: 'username-mismatch',
            onConfirm: async () => {
              setShowConfirmModal(false);
              setConfirmModalConfig(null);

              // Retry with forceAssignment flag
              setActionLoading(true);
              try {
                const forceRequestBody = { ...requestBody, forceAssignment: true };
                const forceResponse = await fetchWithCsrf(`/api/admin/requests/${resolvedParams.id}/manual-assign`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(forceRequestBody),
                });

                if (!forceResponse.ok) {
                  const forceData = await forceResponse.json();
                  throw new Error(forceData.error || 'Failed to manually assign request');
                }

                const forceData = await forceResponse.json();

                // Check for LDAP operation warnings
                if (forceData.warnings && forceData.warnings.length > 0) {
                  // Show warning toast with LDAP failures
                  const warningMessage = `Request linked successfully, but some LDAP operations failed:\n${forceData.warnings.join('\n')}`;
                  showToast(warningMessage, 'warning');
                  console.warn('[Manual Assignment] LDAP warnings:', forceData.warnings);
                } else {
                  // Show success toast if no warnings
                  showToast(forceData.message || 'Request successfully linked to existing account!', 'success');
                }

                // Reset form
                setLinkedAdUsername('');
                setLinkedVpnUsername('');
                setManualAssignmentNotes('');
                setAdUsernameCheckMessage('');
                setVpnUsernameCheckMessage('');

                // Redirect to admin page after successful assignment
                setTimeout(() => router.push('/admin'), 2000);
              } catch (forceErr) {
                const forceMessage = forceErr instanceof Error ? forceErr.message : 'Failed to manually assign request';
                showToast(forceMessage, 'error');
                setError(forceMessage);
              } finally {
                setActionLoading(false);
              }
            },
          });
          setShowConfirmModal(true);
          return;
        }

        throw new Error(data.error || 'Failed to manually assign request');
      }

      const data = await response.json();

      // Check for LDAP operation warnings
      if (data.warnings && data.warnings.length > 0) {
        // Show warning toast with LDAP failures
        const warningMessage = `Request linked successfully, but some LDAP operations failed:\n${data.warnings.join('\n')}`;
        showToast(warningMessage, 'warning');
        console.warn('[Manual Assignment] LDAP warnings:', data.warnings);
      } else {
        // Show success toast if no warnings
        showToast(data.message || 'Request successfully linked to existing account!', 'success');
      }

      // Reset form
      setLinkedAdUsername('');
      setLinkedVpnUsername('');
      setManualAssignmentNotes('');
      setAdUsernameCheckMessage('');
      setVpnUsernameCheckMessage('');

      // Redirect to admin page after successful assignment
      setTimeout(() => router.push('/admin'), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to manually assign request';
      showToast(message, 'error');
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-linear-to-b from-white to-gray-100 flex items-center justify-center">
        <div className="text-gray-900 text-xl font-semibold">Loading...</div>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="min-h-screen bg-linear-to-b from-white to-gray-100 flex items-center justify-center">
        <div className="text-gray-900 text-xl font-semibold">Request not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-white to-gray-100 text-gray-900">
      <div className="container mx-auto px-4 py-6 sm:py-8 max-w-4xl">
        <button
          onClick={() => router.push('/admin')}
          className="text-gray-700 hover:text-black hover:underline mb-4 sm:mb-6 flex items-center gap-2 font-medium text-sm sm:text-base"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </button>

        <div className="bg-white rounded-lg shadow-xl p-4 sm:p-6 md:p-8 border-2 border-gray-200">
          <div className="flex flex-col sm:flex-row justify-between items-start mb-4 sm:mb-6 gap-3 sm:gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 mb-2">Access Request Details</h1>
              <p className="text-sm sm:text-base text-gray-600 break-all">Request ID: {request.id}</p>
            </div>
            <div>
              <span className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap ${request.status === 'pending_verification' ? 'bg-gray-100 text-gray-800' :
                request.status === 'pending_student_directors' ? 'bg-blue-100 text-blue-800' :
                  request.status === 'pending_faculty' ? 'bg-yellow-100 text-yellow-800' :
                    request.status === 'approved' ? 'bg-green-100 text-green-800' :
                      request.status === 'offboarded' ? 'bg-slate-100 text-slate-800' :
                        'bg-red-100 text-red-800'
                }`}>
                {request.status === 'pending_verification' ? 'Pending Verification' :
                  request.status === 'pending_student_directors' ? 'Pending Student Directors' :
                    request.status === 'pending_faculty' ? 'Pending Faculty' :
                      request.status === 'offboarded' ? 'Offboarded' :
                      request.status.charAt(0).toUpperCase() + request.status.slice(1)}
              </span>
            </div>
          </div>

          {error && (
            <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm sm:text-base">
              {error}
            </div>
          )}

          {request.isGrandfatheredAccount && !request.isManuallyAssigned && (
            <div className="mb-4 sm:mb-6 p-4 bg-amber-50 border-2 border-amber-400 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-amber-900 mb-2">⚠️ Grandfathered Account Detected</h3>
                  <p className="text-amber-800 mb-2">
                    An Active Directory account already exists for this user but has no email address associated with it.
                  </p>
                  <div className="bg-amber-100 p-3 rounded border border-amber-300 mb-3">
                    <p className="font-semibold text-amber-900 mb-1">Detected Username:</p>
                    <p className="font-mono text-lg text-amber-900">{request.ldapUsername || 'Unknown'}</p>
                  </div>
                  <div className="bg-white p-3 rounded border border-amber-300">
                    <p className="font-semibold text-amber-900 mb-2">⚠️ Important - Do NOT create a new account!</p>
                    <ul className="list-disc list-inside text-amber-800 text-sm space-y-1">
                      <li>This user already has an Active Directory account</li>
                      <li>Use &quot;Link to Existing Account&quot; option below instead</li>
                      <li>Creating a new account will cause conflicts</li>
                      <li>The username field below is pre-filled for linking</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4 sm:space-y-6">
            <section>
              <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-gray-900">User Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="text-gray-600 text-xs sm:text-sm font-medium">Name</label>
                  <p className="text-sm sm:text-base text-gray-900 font-semibold wrap-break-word">{request.name}</p>
                </div>
                <div>
                  <label className="text-gray-600 text-xs sm:text-sm font-medium">Email</label>
                  <p className="text-sm sm:text-base text-gray-900 font-semibold break-all">{request.email}</p>
                </div>
                <div>
                  <label className="text-gray-600 text-xs sm:text-sm font-medium">Account Type</label>
                  <p className="text-sm sm:text-base text-gray-900 font-semibold">
                    {request.isInternal ? 'Internal (@cpp.edu)' : 'External'}
                  </p>
                </div>
                {request.institution && (
                  <div>
                    <label className="text-gray-600 text-xs sm:text-sm font-medium">Institution</label>
                    <p className="text-sm sm:text-base text-gray-900 font-semibold wrap-break-word">{request.institution}</p>
                  </div>
                )}
                {request.event && (
                  <div className="md:col-span-2">
                    <label className="text-gray-600 text-xs sm:text-sm font-medium">Event</label>
                    <div className="bg-gray-50 border border-gray-300 rounded-lg p-3 mt-1">
                      <p className="text-sm sm:text-base text-gray-900 font-semibold">{request.event.name}</p>
                      {request.event.description && (
                        <p className="text-xs sm:text-sm text-gray-600 mt-1">{request.event.description}</p>
                      )}
                      {request.event.endDate && (
                        <p className="text-xs sm:text-sm text-gray-500 mt-1">
                          Event Expires: {new Date(request.event.endDate).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {request.eventReason && !request.event && (
                  <div className="md:col-span-2">
                    <label className="text-gray-600 text-xs sm:text-sm font-medium">Event/Reason for Access</label>
                    <p className="text-sm sm:text-base text-gray-900 font-semibold wrap-break-word">{request.eventReason}</p>
                  </div>
                )}
                {request.accessEndTime && (
                  <div>
                    <label className="text-gray-600 text-xs sm:text-sm font-medium">Requested Access End Time</label>
                    <p className="text-sm sm:text-base text-gray-900 font-semibold">
                      {new Date(request.accessEndTime).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            </section>

            <section className="border-t border-gray-200 pt-4 sm:pt-6">
              <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-gray-900">Verification Status</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="text-gray-600 text-xs sm:text-sm font-medium">Email Verified</label>
                  <p className="text-sm sm:text-base text-gray-900 font-semibold">
                    {request.isVerified ? (
                      <span className="text-green-600">✓ Verified</span>
                    ) : (
                      <span className="text-red-600">✗ Not Verified</span>
                    )}
                  </p>
                </div>
                {request.verifiedAt && (
                  <div>
                    <label className="text-gray-600 text-xs sm:text-sm font-medium">Verified At</label>
                    <p className="text-sm sm:text-base text-gray-900 font-semibold">
                      {new Date(request.verifiedAt).toLocaleString()}
                    </p>
                  </div>
                )}
                <div>
                  <label className="text-gray-600 text-xs sm:text-sm font-medium">Request Created</label>
                  <p className="text-sm sm:text-base text-gray-900 font-semibold">
                    {new Date(request.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </section>

            {request.status === 'rejected' && (
              <section className="border-t border-gray-200 pt-4 sm:pt-6">
                <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-red-900 flex items-center gap-2">
                  <svg className="w-6 h-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  Rejection Information
                </h2>
                <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 sm:p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    {request.rejectedBy && (
                      <div>
                        <label className="text-red-800 text-xs sm:text-sm font-medium">Rejected By</label>
                        <p className="text-sm sm:text-base text-red-900 font-semibold wrap-break-word">{request.rejectedBy}</p>
                      </div>
                    )}
                    {request.rejectedAt && (
                      <div>
                        <label className="text-red-800 text-xs sm:text-sm font-medium">Rejected At</label>
                        <p className="text-sm sm:text-base text-red-900 font-semibold">
                          {new Date(request.rejectedAt).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>
                  {request.rejectionReason && (
                    <div>
                      <label className="text-red-800 text-xs sm:text-sm font-medium block mb-2">Rejection Reason</label>
                      <div className="bg-white border border-red-300 rounded-lg p-3 sm:p-4">
                        <p className="text-sm sm:text-base text-red-900 whitespace-pre-wrap wrap-break-word">
                          {request.rejectionReason}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {request.status === 'approved' && (
              <section className="border-t border-gray-200 pt-4 sm:pt-6">
                <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-gray-900">Account Information</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  {request.ldapUsername && (
                    <div>
                      <label className="text-gray-600 text-xs sm:text-sm font-medium">Domain Username</label>
                      <p className="text-sm sm:text-base text-gray-900 font-semibold break-all">{request.ldapUsername}</p>
                    </div>
                  )}
                  {request.vpnUsername && (
                    <div>
                      <label className="text-gray-600 text-xs sm:text-sm font-medium">VPN Username</label>
                      <p className="text-sm sm:text-base text-gray-900 font-semibold break-all">{request.vpnUsername}</p>
                    </div>
                  )}
                  {request.acknowledgedAt && (
                    <div>
                      <label className="text-gray-600 text-xs sm:text-sm font-medium">Acknowledged At</label>
                      <p className="text-sm sm:text-base text-gray-900 font-semibold">
                        {new Date(request.acknowledgedAt).toLocaleString()}
                      </p>
                    </div>
                  )}
                  {request.acknowledgedBy && (
                    <div>
                      <label className="text-gray-600 text-xs sm:text-sm font-medium">Acknowledged By</label>
                      <p className="text-sm sm:text-base text-gray-900 font-semibold wrap-break-word">{request.acknowledgedBy}</p>
                    </div>
                  )}
                  {request.approvedAt && (
                    <div>
                      <label className="text-gray-600 text-xs sm:text-sm font-medium">Approved At</label>
                      <p className="text-sm sm:text-base text-gray-900 font-semibold">
                        {new Date(request.approvedAt).toLocaleString()}
                      </p>
                    </div>
                  )}
                  {request.approvedBy && (
                    <div>
                      <label className="text-gray-600 text-xs sm:text-sm font-medium">Approved By</label>
                      <p className="text-sm sm:text-base text-gray-900 font-semibold wrap-break-word">{request.approvedBy}</p>
                    </div>
                  )}
                  {request.accountExpiresAt && (
                    <div>
                      <label className="text-gray-600 text-xs sm:text-sm font-medium">Account Disables</label>
                      <p className="text-sm sm:text-base text-gray-900 font-semibold">
                        {new Date(request.accountExpiresAt).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="border-t border-gray-200 pt-4 sm:pt-6">
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Comments & Notes</h2>
                <button
                  onClick={() => setShowCommentsSection(!showCommentsSection)}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  {showCommentsSection ? 'Hide' : 'Show'} ({comments.length})
                </button>
              </div>

              {showCommentsSection && (
                <div className="space-y-4">
                  <div className="bg-gray-50 p-3 sm:p-4 rounded-lg">
                    <label htmlFor="new-comment" className="block text-sm font-medium text-gray-700 mb-2">
                      Add a Comment
                    </label>
                    <textarea
                      id="new-comment"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      placeholder="Add notes, observations, or important information about this request..."
                    />
                    <button
                      onClick={handleAddComment}
                      disabled={!newComment.trim() || actionLoading}
                      className="mt-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Add Comment
                    </button>
                  </div>

                  <div className="space-y-3">
                    {comments.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-4">No comments yet. Add the first one!</p>
                    ) : (
                      comments.map((comment) => (
                        <div
                          key={comment.id}
                          className={`p-3 sm:p-4 border rounded-lg ${comment.type === 'rejection'
                            ? 'bg-red-50 border-red-300'
                            : comment.type === 'approval'
                              ? 'bg-green-50 border-green-300'
                              : 'bg-white border-gray-200'
                            }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {comment.type === 'rejection' && (
                                <svg className="w-4 h-4 text-red-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                              )}
                              {comment.type === 'approval' && (
                                <svg className="w-4 h-4 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              )}
                              <span className={`font-medium text-sm ${comment.type === 'rejection' ? 'text-red-900' :
                                comment.type === 'approval' ? 'text-green-900' :
                                  'text-gray-900'
                                }`}>
                                {comment.author}
                              </span>
                              {comment.type === 'rejection' && (
                                <span className="px-2 py-0.5 bg-red-200 text-red-800 text-xs font-semibold rounded">
                                  REJECTION
                                </span>
                              )}
                              {comment.type === 'approval' && (
                                <span className="px-2 py-0.5 bg-green-200 text-green-800 text-xs font-semibold rounded">
                                  APPROVAL
                                </span>
                              )}
                            </div>
                            <span className={`text-xs ${comment.type === 'rejection' ? 'text-red-600' :
                              comment.type === 'approval' ? 'text-green-600' :
                                'text-gray-500'
                              }`}>
                              {new Date(comment.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className={`text-sm whitespace-pre-wrap ${comment.type === 'rejection' ? 'text-red-900' :
                            comment.type === 'approval' ? 'text-green-900' :
                              'text-gray-700'
                            }`}>
                            {comment.comment}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </section>

            {request.status === 'pending_verification' && (
              <section className="border-t border-gray-200 pt-4 sm:pt-6">
                <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-gray-900">Request Actions</h2>
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-600 mb-4">
                    This request is currently pending email verification from the user. You can reject it now if it appears to be spam or invalid.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      onClick={handleReject}
                      disabled={actionLoading}
                      className="w-full sm:w-auto bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      {actionLoading ? 'Processing...' : 'Reject Request'}
                    </button>
                  </div>
                </div>
              </section>
            )}
            {request.status === 'pending_student_directors' && request.isVerified && (
              <section className="border-t border-gray-200 pt-4 sm:pt-6">
                <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-gray-900">Student Director Setup</h2>

                {request.ldapUsername && (
                  <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
                    <svg className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <p className="text-sm text-blue-800">
                      <strong>Note:</strong> This request was previously moved to Faculty stage. The existing credentials have been loaded and can be edited if needed.
                    </p>
                  </div>
                )}

                <p className="text-gray-600 text-sm sm:text-base mb-4">
                  Set their Domain Account{!request.isInternal && ', VPN username'}, and password. These credentials will be generated automatically upon escalation to faculty.
                </p>

                {!request.isInternal && (
                  <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
                    <svg className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <p className="text-sm text-yellow-800">
                      <strong>Important:</strong> The account will be automatically disabled by Active Directory at the specified disable date/time. Make sure to set the appropriate date and time for account expiration.
                    </p>
                  </div>
                )}

                <div className="space-y-3 sm:space-y-4">
                  <div>
                    <label className="block text-xs sm:text-sm font-medium mb-2 text-gray-900">Domain Username *</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={ldapUsername}
                        onChange={(e) => {
                          setLdapUsername(e.target.value);
                          setUsernameCheckMessage('');
                        }}
                        className="flex-1 px-3 sm:px-4 py-2 bg-white border-2 border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-black focus:border-transparent text-sm sm:text-base"
                        placeholder="username"
                      />
                      {!request.accountCreatedAt && (
                        <button
                          onClick={() => checkUsernameAvailability(ldapUsername)}
                          className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-semibold"
                        >
                          Check
                        </button>
                      )}
                    </div>
                    {!request.accountCreatedAt && usernameCheckMessage && (
                      <p className={`text-xs sm:text-sm mt-1 ${usernameCheckMessage?.includes('available') ? 'text-green-600' : 'text-red-600'}`}>
                        {usernameCheckMessage}
                      </p>
                    )}
                    {request.accountCreatedAt && (
                      <p className="text-xs sm:text-sm mt-1 text-blue-600">
                        Account already exists in Active Directory. Username changes will be applied when you update the account.
                      </p>
                    )}
                  </div>

                  {!request.isInternal && (
                    <div>
                      <label className="block text-xs sm:text-sm font-medium mb-2 text-gray-900">VPN Username *</label>
                      <input
                        type="text"
                        value={vpnUsername}
                        onChange={(e) => setVpnUsername(e.target.value)}
                        className="w-full px-3 sm:px-4 py-2 bg-white border-2 border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-black focus:border-transparent text-sm sm:text-base"
                        placeholder="username"
                      />
                    </div>
                  )}

                  <div className="bg-gray-50 p-4 rounded-lg border-2 border-gray-200">
                    <label className="block text-xs sm:text-sm font-medium mb-2 text-gray-900">Password *</label>

                    <div className="mb-3 p-3 bg-blue-50 border border-blue-300 rounded-lg">
                      <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        <div className="text-xs text-blue-900">
                          <p className="font-semibold mb-1">Windows Default GPO Password Policy:</p>
                          <ul className="list-disc ml-4 space-y-0.5">
                            <li>Minimum length: 7 characters</li>
                            <li>Must contain characters from 3 of 4 categories:</li>
                            <ul className="list-circle ml-4 mt-0.5">
                              <li>Uppercase letters (A-Z)</li>
                              <li>Lowercase letters (a-z)</li>
                              <li>Numbers (0-9)</li>
                              <li>Special characters (!@#$%^&* etc.)</li>
                            </ul>
                            <li>Cannot contain username or parts of full name</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div className="mb-3 relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-3 sm:px-4 py-2 pr-10 bg-white border-2 border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-black focus:border-transparent text-sm sm:text-base font-mono"
                        placeholder="Enter password or generate one below"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>

                    <div className="space-y-3 border-t border-gray-300 pt-3">
                      <button
                        onClick={generatePassword}
                        className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 py-2 rounded-lg transition-colors text-sm"
                      >
                        Generate Password
                      </button>
                    </div>
                  </div>

                  {!request.isInternal && (
                    <DateTimePicker
                      label="Account Disable Date & Time (Expiration)"
                      value={expirationDateTime}
                      onChange={setExpirationDateTime}
                      required
                      placeholder="Select date and time"
                      minDate={new Date()}
                      className="w-full"
                    />
                  )}

                  {!request.isInternal && (
                    <p className="text-gray-600 text-xs sm:text-sm mt-2">
                      Select the date and time when the account will be automatically disabled. External accounts require an expiration date and time.
                    </p>
                  )}

                  {request.accountCreatedAt && (
                    <div className="p-4 bg-green-50 border-2 border-green-200 rounded-lg">
                      <div className="flex items-start gap-3">
                        <svg className="w-6 h-6 text-green-600 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <div>
                          <h4 className="font-semibold text-green-900 mb-1">LDAP Account Previously Created</h4>
                          <p className="text-sm text-green-800">
                            Account was created in Active Directory on {new Date(request.accountCreatedAt).toLocaleString()}
                          </p>
                          <p className="text-sm text-green-800 mt-1">
                            You can update credentials and re-apply them to the LDAP account, or move this request to Faculty Review.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-2 sm:pt-4 border-t border-gray-300">
                    {!request.accountCreatedAt ? (
                      <>
                        <button
                          onClick={handleCreateAccount}
                          disabled={
                            actionLoading ||
                            !usernameCheckMessage?.includes('available') ||
                            request.isGrandfatheredAccount // Disable for grandfathered accounts
                          }
                          className="w-full sm:w-auto bg-green-600 hover:bg-green-500 text-white font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                          title={
                            request.isGrandfatheredAccount
                              ? 'Cannot create new account - use Link to Existing Account instead'
                              : !usernameCheckMessage?.includes('available')
                                ? 'Please check username availability first'
                                : 'Create an account in Active Directory'
                          }
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          {actionLoading ? 'Creating Account...' : 'Create AD Account'}
                        </button>
                        <button
                          onClick={handleManualAssign}
                          disabled={actionLoading}
                          className="w-full sm:w-auto bg-purple-600 hover:bg-purple-500 text-white font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                          title="Link this request to an existing Active Directory account"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          {actionLoading ? 'Processing...' : 'Manual Assignment'}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={handleUpdateAccount}
                          disabled={actionLoading}
                          className="w-full sm:w-auto bg-orange-600 hover:bg-orange-500 text-white font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                          title="Update password and expiration date in Active Directory"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          {actionLoading ? 'Updating...' : 'Update LDAP Account'}
                        </button>
                        <button
                          onClick={handleReturnToFaculty}
                          disabled={actionLoading}
                          className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                          </svg>
                          {actionLoading ? 'Processing...' : 'Return to Faculty'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={handleReject}
                      disabled={actionLoading}
                      className="w-full sm:w-auto bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      {actionLoading ? 'Processing...' : 'Reject Request'}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {request.status === 'pending_faculty' && request.isVerified && (
              <section className="border-t border-gray-200 pt-4 sm:pt-6">
                <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-gray-900">Faculty Account Creation</h2>
                <p className="text-gray-600 text-sm sm:text-base mb-4">
                  Request faculty to create the VPN account using the credentials below. Copy the message and send it to faculty.
                </p>

                <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200 mb-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Account Details</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-600 font-medium">AD Username:</span>
                      <span className="ml-2 text-gray-900 font-semibold">{request.ldapUsername}</span>
                    </div>
                    {!request.isInternal && (
                      <div>
                        <span className="text-gray-600 font-medium">VPN Username:</span>
                        <span className="ml-2 text-gray-900 font-semibold">{request.vpnUsername}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600 font-medium">Password:</span>
                      <span className="ml-2 text-gray-900 font-mono font-semibold">
                        {showPassword ? request.accountPassword : '••••••••'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="text-gray-500 hover:text-gray-700"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    {request.accountExpiresAt && (
                      <div>
                        <span className="text-gray-600 font-medium">Account Disables:</span>
                        <span className="ml-2 text-gray-900 font-semibold">
                          {new Date(request.accountExpiresAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg border-2 border-gray-300 mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-semibold text-gray-900">Message to Faculty</h3>
                    <div className="flex gap-2">
                      <button
                        onClick={copyFacultyMessage}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                      >
                        📋 Copy Message
                      </button>
                      <button
                        onClick={() => setShowFacultyMessage(!showFacultyMessage)}
                        className="px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs font-semibold flex items-center gap-1"
                      >
                        {showFacultyMessage ? (
                          <>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                            Hide
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            Show
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  {showFacultyMessage && (
                    <pre className="text-xs sm:text-sm text-gray-900 whitespace-pre-wrap font-sans bg-white p-3 rounded border border-gray-200 mt-2">
                      {generateFacultyMessage()}
                    </pre>
                  )}
                </div>

                <div className="mb-4">
                  {request.sentToFacultyAt ? (
                    <div>
                      <div className="bg-green-50 p-3 rounded-lg border border-green-200 flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <div className="text-sm flex-1">
                          <span className="text-green-800 font-semibold">Sent to Faculty</span>
                          <span className="text-green-700 ml-2">
                            on {new Date(request.sentToFacultyAt).toLocaleString()} by {request.sentToFacultyBy}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={handleUndoNotifyFaculty}
                        disabled={actionLoading}
                        className="w-full bg-gray-500 hover:bg-gray-600 text-white font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 text-sm"
                      >
                        {actionLoading ? 'Processing...' : 'Undo "Sent to Faculty" Status'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleNotifyFaculty}
                      disabled={actionLoading}
                      className="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 text-sm"
                    >
                      {actionLoading ? 'Processing...' : 'Mark as Sent to Faculty'}
                    </button>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-2 sm:pt-4 border-t border-gray-300">
                  <button
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="w-full sm:w-auto bg-green-600 hover:bg-green-500 text-white font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {actionLoading ? 'Processing...' : 'Confirm Account Created & Approve'}
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={actionLoading}
                    className="w-full sm:w-auto bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    {actionLoading ? 'Processing...' : 'Reject Request'}
                  </button>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200">
                  <button
                    onClick={handleMoveBack}
                    disabled={actionLoading}
                    className="w-full bg-gray-400 hover:bg-gray-500 text-white font-bold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 text-sm flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7 7-7" />
                    </svg>
                    {actionLoading ? 'Processing...' : 'Move Back to Student Directors'}
                  </button>
                  <p className="text-xs text-gray-600 mt-2 text-center">
                    Use this to send the request back to Student Directors if credentials need to be changed
                  </p>
                </div>
              </section>
            )}

            {request.status === 'pending_verification' && (
              <div className="border-t border-gray-200 pt-4 sm:pt-6">
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 sm:p-4 rounded-lg flex items-start gap-2 sm:gap-3">
                  <svg className="w-5 h-5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <p className="text-xs sm:text-sm">This request cannot be processed until the user verifies their email address.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={showRejectModal} onOpenChange={(open) => {
        if (!open) {
          setShowRejectModal(false);
          setRejectionReason('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="rejection-reason" className="block text-sm font-medium text-gray-700 mb-2">
                Rejection Reason
              </label>
              <textarea
                id="rejection-reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Provide a detailed reason for rejecting this request..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectionReason('');
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitRejection}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Reject Request
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showApproveModal} onOpenChange={(open) => {
        if (!open) {
          setShowApproveModal(false);
          setApprovalMessage('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Confirm that the account has been created. You can optionally add a follow-up message that will be included in the email to the user.
            </p>
            <div>
              <label htmlFor="approval-message" className="block text-sm font-medium text-gray-700 mb-2">
                Follow-up Message (Optional)
              </label>
              <textarea
                id="approval-message"
                value={approvalMessage}
                onChange={(e) => setApprovalMessage(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Add any additional information, instructions, or notes for the user..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowApproveModal(false);
                  setApprovalMessage('');
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitApproval}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Approve Request
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {
        (!confirmModalConfig?.type || confirmModalConfig.type === 'standard') && (
          <Dialog open={showConfirmModal} onOpenChange={(open) => !open && setShowConfirmModal(false)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{confirmModalConfig?.title || 'Confirm'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-gray-700">{confirmModalConfig?.message}</p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      confirmModalConfig?.onConfirm();
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )
      }

      {
        confirmModalConfig?.type === 'username-mismatch' && (
          <Dialog open={showConfirmModal} onOpenChange={(open) => {
            if (!open) {
              setShowConfirmModal(false);
              setConfirmModalConfig(null);
              setShowManualAssignModal(true);
            }
          }}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{confirmModalConfig.title}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <div className="text-sm text-yellow-900 whitespace-pre-line">
                      {confirmModalConfig.message}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setShowConfirmModal(false);
                      setConfirmModalConfig(null);
                      setShowManualAssignModal(true); // Re-open manual assign modal
                    }}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmModalConfig.onConfirm}
                    className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-semibold"
                  >
                    Force Assignment
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )
      }

      <Dialog open={showManualAssignModal} onOpenChange={(open) => {
        if (!open) {
          setShowManualAssignModal(false);
          setLinkedAdUsername('');
          setLinkedVpnUsername('');
          setManualAssignmentNotes('');
          setAdUsernameCheckMessage('');
          setVpnUsernameCheckMessage('');
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manual Assignment to Existing Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="text-sm text-blue-900">
                  <p className="font-semibold mb-1">About Manual Assignment</p>
                  <p>
                    Use this feature when the user already has an existing Active Directory account{!request?.isInternal && ' or VPN access'}.
                    This will link their access request to the existing account without creating a new one.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="linked-ad-username" className="block text-sm font-medium text-gray-700 mb-2">
                Existing Active Directory Username *
              </label>
              <div className="flex gap-2">
                <input
                  id="linked-ad-username"
                  type="text"
                  value={linkedAdUsername}
                  onChange={(e) => {
                    setLinkedAdUsername(e.target.value);
                    setAdUsernameCheckMessage('');
                  }}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Enter existing AD username"
                />
                <button
                  onClick={() => checkAdUsernameExists(linkedAdUsername)}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-semibold"
                >
                  Verify
                </button>
              </div>
              {adUsernameCheckMessage && (
                <p className={`text-sm mt-1 ${adUsernameCheckMessage?.includes('exists') ? 'text-green-600' : 'text-red-600'}`}>
                  {adUsernameCheckMessage}
                </p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                {request?.isInternal
                  ? 'For internal users, this will link to their existing @cpp.edu account'
                  : 'Enter the Active Directory username that already exists for this user'}
              </p>
            </div>

            {!request?.isInternal && (
              <div>
                <label htmlFor="linked-vpn-username" className="block text-sm font-medium text-gray-700 mb-2">
                  Existing VPN Username (Optional)
                </label>
                <div className="flex gap-2">
                  <input
                    id="linked-vpn-username"
                    type="text"
                    value={linkedVpnUsername}
                    onChange={(e) => {
                      setLinkedVpnUsername(e.target.value);
                      setVpnUsernameCheckMessage('');
                    }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="Enter existing VPN username (if different from AD)"
                  />
                  {linkedVpnUsername.trim() && (
                    <button
                      onClick={() => checkVpnUsernameExists(linkedVpnUsername)}
                      className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-semibold"
                    >
                      Verify
                    </button>
                  )}
                </div>
                {vpnUsernameCheckMessage && (
                  <p className={`text-sm mt-1 ${vpnUsernameCheckMessage?.includes('exists') ? 'text-green-600' : 'text-red-600'}`}>
                    {vpnUsernameCheckMessage}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Leave blank if the VPN username is the same as the AD username
                </p>
              </div>
            )}

            <div>
              <label htmlFor="manual-assignment-notes" className="block text-sm font-medium text-gray-700 mb-2">
                Assignment Notes (Optional)
              </label>
              <textarea
                id="manual-assignment-notes"
                value={manualAssignmentNotes}
                onChange={(e) => setManualAssignmentNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="Add any notes about why this account is being manually assigned..."
              />
            </div>

            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="text-sm text-yellow-900">
                  <p className="font-semibold mb-1">Important</p>
                  <p>
                    This will approve the request and link it to the existing account.
                    Make sure the username is correct before proceeding.
                    {request?.isInternal
                      ? ' For internal users, the AD account description will be updated but the existing email will be preserved.'
                      : ' The user\'s email and name will be updated in the VPN account if it exists.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowManualAssignModal(false);
                  setLinkedAdUsername('');
                  setLinkedVpnUsername('');
                  setManualAssignmentNotes('');
                  setAdUsernameCheckMessage('');
                  setVpnUsernameCheckMessage('');
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitManualAssignment}
                disabled={!linkedAdUsername.trim() || !adUsernameCheckMessage?.includes('exists')}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Link to Existing Account
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.isVisible}
        onClose={hideToast}
      />
    </div >
  );
}
