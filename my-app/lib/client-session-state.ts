export type ClientSessionState = {
  isAuthenticated: boolean;
  isAdmin: boolean;
  username: string;
  displayName: string;
};

export const SESSION_STATE_EVENT = 'uarSessionStateChanged';

declare global {
  interface Window {
    __UAR_SESSION_STATE__?: ClientSessionState;
  }
}

export function publishClientSessionState(state: ClientSessionState) {
  if (typeof window === 'undefined') {
    return;
  }

  window.__UAR_SESSION_STATE__ = state;
  window.dispatchEvent(new CustomEvent<ClientSessionState>(SESSION_STATE_EVENT, { detail: state }));
}

export function readClientSessionState() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.__UAR_SESSION_STATE__;
}
