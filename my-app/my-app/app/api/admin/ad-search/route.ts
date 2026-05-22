import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/session';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { searchLDAPUser, listUsersInOU } from '@/lib/ldap';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const session = { username: admin.username };

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query) {
      return NextResponse.json({ error: 'Query parameter required' }, { status: 400 });
    }

    // Try exact username search first
    let found = false;
    let userData = null;
    
    try {
      const user = await searchLDAPUser(query);
      if (user && user.attributes) {
        found = true;
        // Parse attributes
        let username = '';
        let displayName = '';
        let email = '';
        
        for (const attr of user.attributes) {
          if (attr.type === 'sAMAccountName' && attr.values.length > 0) {
            username = attr.values[0];
          } else if (attr.type === 'cn' && attr.values.length > 0) {
            displayName = attr.values[0];
          } else if (attr.type === 'mail' && attr.values.length > 0) {
            email = attr.values[0];
          }
        }

        userData = {
          username,
          displayName,
          email,
          dn: user.objectName,
        };

        // Log audit action
        await logAuditAction({
          action: AuditActions.SEARCH_AD,
          category: AuditCategories.USER,
          username: session.username,
          details: {
            query,
            found: true,
            resultUsername: username,
          },
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
        });

        return NextResponse.json({
          success: true,
          data: [userData],
        });
      }
    } catch (error) {
      console.error('AD search error:', error);
    }

    // Log no results found
    await logAuditAction({
      action: AuditActions.SEARCH_AD,
      category: AuditCategories.USER,
      username: session.username,
      details: {
        query,
        found: false,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    // If exact match not found, return empty result
    return NextResponse.json({
      success: true,
      data: [],
    });
  } catch (error) {
    console.error('AD search error:', error);
    return NextResponse.json(
      { error: 'Failed to search Active Directory' },
      { status: 500 }
    );
  }
}
