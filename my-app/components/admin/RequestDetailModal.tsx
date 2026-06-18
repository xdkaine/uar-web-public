'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from '@/hooks/useToast';

interface RequestDetail {
  id: string;
  name: string;
  email: string;
  isInternal: boolean;
  needsDomainAccount: boolean;
  isVerified: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;

  // Internal fields
  ldapUsername?: string;
  vpnUsername?: string;
  accountPassword?: string;
  accountCreatedAt?: string;
  accountExpiresAt?: string;
  studentDirectorApproval?: string;
  studentDirectorApprovedAt?: string;
  facultyApproval?: string;
  facultyApprovedAt?: string;

  // External fields
  linkedAdUsername?: string;
  isManuallyAssigned?: boolean;
  isGrandfatheredAccount?: boolean;

  // Common fields
  institution?: string;
  eventReason?: string;
  eventId?: string;
  event?: {
    id: string;
    name: string;
    startDate?: string;
    endDate?: string;
    description?: string;
  };

  // Additional details
  rejectionReason?: string;
  adminNotes?: string;
  emailSentAt?: string;
  provisioningState?: string;
  provisioningError?: string;
  provisioningCompletedAt?: string;
  version?: number;

  // Metadata
  ipAddress?: string;
  userAgent?: string;
  referrer?: string;
}

interface RequestDetailModalProps {
  requestId: string;
  onClose: () => void;
}

export default function RequestDetailModal({ requestId, onClose }: RequestDetailModalProps) {
  const { showToast } = useToast();
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'technical'>('overview');

  const fetchRequestDetails = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/requests/${requestId}`);

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch request details');
      }

      const data = await res.json();
      // Handle both direct response and wrapped response
      setRequest(data.request || data);
    } catch (error) {
      console.error('Error fetching request details:', error);
      showToast(error instanceof Error ? error.message : 'Failed to load request details', 'error');
    } finally {
      setLoading(false);
    }
  }, [requestId, showToast]);

  useEffect(() => {
    fetchRequestDetails();
  }, [fetchRequestDetails]);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending_verification: 'bg-gray-100 text-gray-800 border-gray-300',
      pending_student_directors: 'bg-blue-100 text-blue-800 border-blue-300',
      pending_faculty: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      approved: 'bg-green-100 text-green-800 border-green-300',
      rejected: 'bg-red-100 text-red-800 border-red-300',
      offboarded: 'bg-slate-100 text-slate-800 border-slate-300',
    };
    return colors[status] || 'bg-gray-100 text-gray-800 border-gray-300';
  };

  const formatDate = (date?: string) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const InfoRow = ({ label, value, highlight = false }: { label: string; value?: ReactNode; highlight?: boolean }) => (
    <div className="flex py-3 border-b border-gray-200 last:border-b-0">
      <dt className="w-1/3 font-semibold text-gray-700 break-all">{label}</dt>
      <dd className={`w-2/3 ${highlight ? 'font-bold text-gray-900' : 'text-gray-900'} break-all`}>
        {value || 'N/A'}
      </dd>
    </div>
  );

  if (loading) {
    return (
      <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Loading...</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!request) {
    return (
      <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
          </DialogHeader>
          <div className="text-center py-8">
            <p className="text-gray-600">Request not found</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <div className="bg-blue-50 p-6 rounded-lg border-2 border-blue-200">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">{request.name}</h3>
                <p className="text-gray-700 text-lg">{request.email}</p>
              </div>
              <span className={`px-4 py-2 rounded-full text-sm font-bold border-2 ${getStatusColor(request.status)}`}>
                {request.status.replace(/_/g, ' ').toUpperCase()}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <span className="text-sm font-semibold text-gray-600">Type</span>
                <p className="text-lg font-bold text-gray-900">
                  {request.isInternal ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                      Internal Student
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 bg-purple-500 rounded-full"></span>
                      External Visitor
                    </span>
                  )}
                </p>
              </div>
              <div>
                <span className="text-sm font-semibold text-gray-600">Request ID</span>
                <p className="text-sm font-mono text-gray-900 break-all">{request.id}</p>
              </div>
            </div>
          </div>

          <div className="border-b border-gray-200">
            <nav className="flex gap-4">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-4 py-2 font-semibold border-b-2 transition-colors ${activeTab === 'overview'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveTab('technical')}
                className={`px-4 py-2 font-semibold border-b-2 transition-colors ${activeTab === 'technical'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
              >
                Technical Details
              </button>
            </nav>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="bg-white border-2 border-gray-200 rounded-lg p-6">
                  <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Basic Information
                  </h4>
                  <dl className="space-y-0">
                    <InfoRow label="Full Name" value={request.name} highlight />
                    <InfoRow label="Email Address" value={request.email} highlight />
                    <InfoRow label="Request Type" value={request.isInternal ? 'Internal Student' : 'External Visitor'} />
                    <InfoRow label="Email Verified" value={request.isVerified ? '✓ Yes' : '✗ No'} />
                    {request.institution && <InfoRow label="Institution" value={request.institution} />}
                  </dl>
                </div>

                {(request.event || request.eventReason) && (
                  <div className="bg-white border-2 border-gray-200 rounded-lg p-6">
                    <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Event Information
                    </h4>
                    <dl className="space-y-0">
                      <InfoRow label="Event Name" value={request.event?.name || request.eventReason} />
                      {request.event?.description && <InfoRow label="Description" value={request.event.description} />}
                      {request.event?.startDate && <InfoRow label="Start Date" value={formatDate(request.event.startDate)} />}
                      {request.event?.endDate && <InfoRow label="End Date" value={formatDate(request.event.endDate)} />}
                    </dl>
                  </div>
                )}

                {request.isInternal && request.needsDomainAccount && (
                  <div className="bg-white border-2 border-gray-200 rounded-lg p-6">
                    <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      Domain Account
                    </h4>
                    <dl className="space-y-0">
                      <InfoRow label="Username" value={request.ldapUsername} highlight />
                      <InfoRow label="Password Status" value={request.accountPassword ? '[ENCRYPTED]' : 'Not Set'} />
                      {request.accountCreatedAt && <InfoRow label="Account Created" value={formatDate(request.accountCreatedAt)} />}
                      {request.accountExpiresAt && <InfoRow label="Account Expires" value={formatDate(request.accountExpiresAt)} />}
                      {request.provisioningState && <InfoRow label="Provisioning State" value={request.provisioningState} />}
                    </dl>
                  </div>
                )}

                {!request.isInternal && request.linkedAdUsername && (
                  <div className="bg-white border-2 border-gray-200 rounded-lg p-6">
                    <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      Linked Account
                    </h4>
                    <dl className="space-y-0">
                      <InfoRow label="AD Username" value={request.linkedAdUsername} highlight />
                      <InfoRow label="Manually Assigned" value={request.isManuallyAssigned ? 'Yes' : 'No'} />
                      <InfoRow label="Grandfathered" value={request.isGrandfatheredAccount ? 'Yes' : 'No'} />
                    </dl>
                  </div>
                )}

                {request.isInternal && (
                  <div className="bg-white border-2 border-gray-200 rounded-lg p-6">
                    <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Approval Status
                    </h4>
                    <dl className="space-y-0">
                      <InfoRow
                        label="Student Director"
                        value={request.studentDirectorApproval || 'Pending'}
                      />
                      {request.studentDirectorApprovedAt && (
                        <InfoRow label="SD Approved At" value={formatDate(request.studentDirectorApprovedAt)} />
                      )}
                      <InfoRow
                        label="Faculty Advisor"
                        value={request.facultyApproval || 'Pending'}
                      />
                      {request.facultyApprovedAt && (
                        <InfoRow label="Faculty Approved At" value={formatDate(request.facultyApprovedAt)} />
                      )}
                    </dl>
                  </div>
                )}

                {request.status === 'rejected' && request.rejectionReason && (
                  <div className="bg-red-50 border-2 border-red-200 rounded-lg p-6">
                    <h4 className="text-lg font-bold text-red-900 mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Rejection Reason
                    </h4>
                    <p className="text-red-900 whitespace-pre-wrap">{request.rejectionReason}</p>
                  </div>
                )}

                {request.adminNotes && (
                  <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-6">
                    <h4 className="text-lg font-bold text-yellow-900 mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Admin Notes
                    </h4>
                    <p className="text-yellow-900 whitespace-pre-wrap">{request.adminNotes}</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'technical' && (
              <div className="space-y-6">
                <div className="bg-white border-2 border-gray-200 rounded-lg p-6">
                  <h4 className="text-lg font-bold text-gray-900 mb-4">System Information</h4>
                  <dl className="space-y-0">
                    <InfoRow label="Request ID" value={<span className="font-mono text-xs break-all">{request.id}</span>} />
                    <InfoRow label="Version" value={request.version} />
                    <InfoRow label="Created At" value={formatDate(request.createdAt)} />
                    <InfoRow label="Updated At" value={formatDate(request.updatedAt)} />
                    <InfoRow label="IP Address" value={request.ipAddress} />
                    {request.userAgent && <InfoRow label="User Agent" value={<span className="text-xs break-all">{request.userAgent}</span>} />}
                    {request.referrer && <InfoRow label="Referrer" value={<span className="text-xs break-all">{request.referrer}</span>} />}
                  </dl>
                </div>

                {request.provisioningState && (
                  <div className="bg-white border-2 border-gray-200 rounded-lg p-6">
                    <h4 className="text-lg font-bold text-gray-900 mb-4">Provisioning Details</h4>
                    <dl className="space-y-0">
                      <InfoRow label="State" value={request.provisioningState} />
                      {request.provisioningCompletedAt && (
                        <InfoRow label="Completed At" value={formatDate(request.provisioningCompletedAt)} />
                      )}
                      {request.provisioningError && (
                        <InfoRow label="Error" value={<span className="text-red-600 text-sm break-all">{request.provisioningError}</span>} />
                      )}
                    </dl>
                  </div>
                )}

                {request.eventId && (
                  <div className="bg-white border-2 border-gray-200 rounded-lg p-6">
                    <h4 className="text-lg font-bold text-gray-900 mb-4">Event Association</h4>
                    <dl className="space-y-0">
                      <InfoRow label="Event ID" value={<span className="font-mono text-xs break-all">{request.eventId}</span>} />
                      <InfoRow label="Event Name" value={request.event?.name} />
                    </dl>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t-2 border-gray-200">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-semibold transition-colors"
            >
              Close
            </button>
            <a
              href={`/admin?tab=requests&highlight=${request.id}`}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors"
            >
              View in Requests Tab
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog >
  );
}
