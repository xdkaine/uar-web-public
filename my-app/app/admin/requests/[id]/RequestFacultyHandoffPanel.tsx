import type { AccessRequest } from './RequestDetailTypes';
import { FacultyAccountDetails, FacultyDecisionActions, FacultyMessage, FacultyNotification } from './RequestFacultyHandoffSections';

interface RequestFacultyHandoffPanelProps {
  request: AccessRequest;
  stageLabel: string | undefined;
  actionLoading: boolean;
  canRevealPassword: boolean;
  showFacultyPassword: boolean;
  revealedFacultyPassword: string;
  revealPasswordLoading: boolean;
  showFacultyMessage: boolean;
  onToggleFacultyPassword: () => void;
  onRevealFacultyPassword: () => void;
  onCopyFacultyMessage: () => void;
  onToggleFacultyMessage: () => void;
  generateFacultyMessage: () => string;
  onUndoNotifyFaculty: () => void;
  onNotifyFaculty: () => void;
  onApprove: () => void;
  onReject: () => void;
  onMoveBack: () => void;
}

export default function RequestFacultyHandoffPanel({ request, stageLabel, actionLoading, canRevealPassword, showFacultyPassword, revealedFacultyPassword, revealPasswordLoading, showFacultyMessage, onToggleFacultyPassword, onRevealFacultyPassword, onCopyFacultyMessage, onToggleFacultyMessage, generateFacultyMessage, onUndoNotifyFaculty, onNotifyFaculty, onApprove, onReject, onMoveBack }: RequestFacultyHandoffPanelProps) {
  return <section className="border-t border-border pt-4 sm:pt-6">
    <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-foreground">{stageLabel}</h2>
    <p className="text-muted-foreground text-sm sm:text-base mb-4">Request faculty to create the VPN account using the credentials below. Copy the message and send it to faculty.</p>
    <FacultyAccountDetails request={request} canRevealPassword={canRevealPassword} showFacultyPassword={showFacultyPassword} revealedFacultyPassword={revealedFacultyPassword} revealPasswordLoading={revealPasswordLoading} onToggleFacultyPassword={onToggleFacultyPassword} onRevealFacultyPassword={onRevealFacultyPassword} />
    <FacultyMessage request={request} showFacultyMessage={showFacultyMessage} revealedFacultyPassword={revealedFacultyPassword} onCopyFacultyMessage={onCopyFacultyMessage} onToggleFacultyMessage={onToggleFacultyMessage} generateFacultyMessage={generateFacultyMessage} />
    <FacultyNotification request={request} actionLoading={actionLoading} onUndoNotifyFaculty={onUndoNotifyFaculty} onNotifyFaculty={onNotifyFaculty} />
    <FacultyDecisionActions actionLoading={actionLoading} onApprove={onApprove} onReject={onReject} onMoveBack={onMoveBack} />
  </section>;
}
