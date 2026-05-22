declare module 'react-turnstile' {
  import * as React from 'react';

  interface TurnstileProps {
    sitekey: string;
    onVerify: (token: string) => void;
    onError?: (error?: any) => void;
    onExpire?: () => void;
    theme?: 'light' | 'dark' | 'auto';
    size?: 'normal' | 'compact' | 'invisible';
    tabIndex?: number;
    action?: string;
    cData?: string;
    responseField?: boolean;
    responseFieldName?: string;
    retry?: 'auto' | 'never';
    retryInterval?: number;
    refreshExpired?: 'auto' | 'manual' | 'never';
    appearance?: 'always' | 'execute' | 'interaction-only';
    execution?: 'render' | 'execute';
    className?: string;
    style?: React.CSSProperties;
  }

  const Turnstile: React.FC<TurnstileProps>;
  export default Turnstile;
}
