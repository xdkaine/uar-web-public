import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';
import {
  ActivationCredentialsForm,
  ActivationSuccess,
  InvalidActivationLink,
  type PasswordRequirementState,
} from './ActivationAccountViews';

const unmetRequirements: PasswordRequirementState = {
  length: false,
  uppercase: false,
  lowercase: false,
  number: false,
  special: false,
  supportedChars: false,
  noUsername: false,
};

function renderWithMotion(element: React.ReactElement): string {
  return renderToStaticMarkup(createElement(LazyMotionBoundary, null, element));
}

describe('activation account views', () => {
  it('keeps invalid and successful activation states distinct', () => {
    const invalidHtml = renderWithMotion(createElement(InvalidActivationLink));
    const successHtml = renderWithMotion(createElement(ActivationSuccess));

    expect(invalidHtml).toContain('Invalid Activation Link');
    expect(invalidHtml).toContain('href="/login"');
    expect(successHtml).toContain('Account Activated!');
    expect(successHtml).toContain('href="/account/welcome"');
  });

  it('preserves the credential fields, validation message, and disabled submit state', () => {
    const html = renderWithMotion(createElement(ActivationCredentialsForm, {
      username: 'student',
      password: 'Example1!',
      confirmPassword: 'Different1!',
      visibility: {
        password: false,
        confirmPassword: true,
      },
      status: {
        isLoading: false,
        isValid: false,
      },
      error: 'Please ensure all requirements are met',
      issues: ['Passwords do not match'],
      passwordRequirements: unmetRequirements,
      onUsernameChange: vi.fn(),
      onPasswordChange: vi.fn(),
      onConfirmPasswordChange: vi.fn(),
      onTogglePassword: vi.fn(),
      onToggleConfirmPassword: vi.fn(),
      onSubmit: vi.fn(),
    }));

    expect(html).toContain('Active Directory Username');
    expect(html).toContain('type="password"');
    expect(html).toContain('type="text"');
    expect(html).toContain('Passwords do not match');
    expect(html).toContain('disabled=""');
  });
});
