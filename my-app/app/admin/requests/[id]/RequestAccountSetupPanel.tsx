import type { AccessRequest } from './RequestDetailTypes';
import { AccountActions, AccountExpiration, AccountIdentityFields, AccountPasswordFields, ExistingAccountNotice, RequestSetupAlerts } from './RequestAccountSetupSections';

interface RequestAccountSetupPanelProps {
  request: AccessRequest;
  stageLabel: string | undefined;
  actionLoading: boolean;
  ldapUsername: string;
  vpnUsername: string;
  password: string;
  showPassword: boolean;
  expirationDateTime: string;
  minExpirationDate: Date | undefined;
  usernameCheckMessage: string;
  vpnModuleEnabled: boolean;
  onLdapUsernameChange: (value: string) => void;
  onVpnUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onCheckUsernameAvailability: () => void;
  onGeneratePassword: () => void;
  onExpirationDateTimeChange: (value: string) => void;
  onCreateAccount: () => void;
  onManualAssign: () => void;
  onUpdateAccount: () => void;
  onReturnToFaculty: () => void;
  onReject: () => void;
  supportsFacultyHandoff: boolean;
}

export default function RequestAccountSetupPanel({ request, stageLabel, actionLoading, ldapUsername, vpnUsername, password, showPassword, expirationDateTime, minExpirationDate, usernameCheckMessage, vpnModuleEnabled, onLdapUsernameChange, onVpnUsernameChange, onPasswordChange, onTogglePassword, onCheckUsernameAvailability, onGeneratePassword, onExpirationDateTimeChange, onCreateAccount, onManualAssign, onUpdateAccount, onReturnToFaculty, onReject, supportsFacultyHandoff }: RequestAccountSetupPanelProps) {
  return <section className="border-t border-border pt-4 sm:pt-6">
    <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-foreground">{stageLabel} setup</h2>
    <RequestSetupAlerts request={request} />
    <div className="space-y-3 sm:space-y-4">
      <AccountIdentityFields request={request} ldapUsername={ldapUsername} vpnUsername={vpnUsername} usernameCheckMessage={usernameCheckMessage} vpnModuleEnabled={vpnModuleEnabled} onLdapUsernameChange={onLdapUsernameChange} onVpnUsernameChange={onVpnUsernameChange} onCheckUsernameAvailability={onCheckUsernameAvailability} />
      <AccountPasswordFields password={password} showPassword={showPassword} onPasswordChange={onPasswordChange} onTogglePassword={onTogglePassword} onGeneratePassword={onGeneratePassword} />
      <AccountExpiration request={request} expirationDateTime={expirationDateTime} minExpirationDate={minExpirationDate} onExpirationDateTimeChange={onExpirationDateTimeChange} />
      <ExistingAccountNotice request={request} />
      <AccountActions request={request} actionLoading={actionLoading} usernameCheckMessage={usernameCheckMessage} supportsFacultyHandoff={supportsFacultyHandoff} onCreateAccount={onCreateAccount} onManualAssign={onManualAssign} onUpdateAccount={onUpdateAccount} onReturnToFaculty={onReturnToFaculty} onReject={onReject} />
    </div>
  </section>;
}
