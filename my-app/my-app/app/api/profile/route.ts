import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/session';
import { searchLDAPUser } from '@/lib/ldap';
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

    const profile = {
      username: getAttributeValue('sAMAccountName'),
      // Prefer displayName, then cn, then username
      displayName: getAttributeValue('displayName') || getAttributeValue('cn') || session.username,
      email: getAttributeValue('mail'),
      groups: getAttributeValues('memberOf'),
      distinguishedName: userInfo.objectName,
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
