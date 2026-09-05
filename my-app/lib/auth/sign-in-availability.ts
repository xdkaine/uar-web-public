import { prisma } from '@/lib/prisma';

export class SignInDisabledError extends Error {
  constructor() {
    super('Sign-in is currently disabled.');
    this.name = 'SignInDisabledError';
  }
}

/** Read through: maintenance changes must fence in-flight credential flows. */
export async function assertSignInEnabled(): Promise<void> {
  const settings = await prisma.systemSettings.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { loginDisabled: true },
  });
  if (settings?.loginDisabled) throw new SignInDisabledError();
}
