import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/session';
import { searchLDAPUser } from '@/lib/ldap';
import { prisma } from '@/lib/prisma';
import { appLogger } from '@/lib/logger';

export async function GET() {
  try {
    // Check if user is authenticated
    const session = await getSessionFromCookies();

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Fetch user details from Active Directory
    const userInfo = await searchLDAPUser(session.username);

    if (!userInfo) {
      return NextResponse.json(
        { error: 'User not found in directory' },
        { status: 404 }
      );
    }

    // Extract relevant attributes
    const getAttributeValue = (type: string): string => {
      const attr = userInfo.attributes.find(a => a.type === type);
      return attr?.values[0] || '';
    };

    const getAttributeValues = (type: string): string[] => {
      const attr = userInfo.attributes.find(a => a.type === type);
      return attr?.values || [];
    };

    // Identity-provider context for the profile's sign-in section: how this
    // session authenticated and whether it is bound to a live IdP session
    // (ADR-0012/ADR-0014). Directory data above stays the source of truth for
    // attributes; nothing sensitive (no sid value) leaves the server.
    let idpLinked = false;
    try {
      const sessionRow = await prisma.session.findUnique({
        where: { id: session.id },
        select: { providerSid: true },
      });
      idpLinked = Boolean(sessionRow?.providerSid);
    } catch (lookupError) {
      appLogger.warn('Failed to resolve IdP linkage for profile', {
        username: session.username,
        error: lookupError instanceof Error ? lookupError.message : 'unknown',
      });
    }

    const profile = {
      username: getAttributeValue('sAMAccountName'),
      // Prefer displayName, then cn, then username
      displayName: getAttributeValue('displayName') || getAttributeValue('cn') || session.username,
      email: getAttributeValue('mail'),
      groups: getAttributeValues('memberOf'),
      distinguishedName: userInfo.objectName,
      identityProvider: {
        authProvider: session.authProvider,
        idpLinked,
      },
    };

    appLogger.info('Profile fetched successfully', { username: session.username });

    return NextResponse.json(profile);
  } catch (error) {
    appLogger.error('Error fetching user profile', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 }
    );
  }
}
