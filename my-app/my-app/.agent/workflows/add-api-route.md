---
description: Add a new API route endpoint
---

# Add API Route Workflow

Use this workflow when adding a new API endpoint.

## Steps

### 1. Create the Route File

Create `my-app/app/api/admin/your-feature/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, getIpAddress, getUserAgent, AuditActions, AuditCategories } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';

// GET - List items
export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const items = await prisma.yourModel.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error('Error fetching items:', error);
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 });
  }
}

// POST - Create item
export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    
    // Validate input
    if (!body.requiredField) {
      return NextResponse.json({ error: 'Missing required field' }, { status: 400 });
    }

    // Create item
    const item = await prisma.yourModel.create({
      data: {
        name: body.name,
        createdBy: admin.username,
      },
    });

    // Audit log
    await logAuditAction({
      action: AuditActions.CREATE_RECORD,
      category: AuditCategories.ADMIN,
      username: admin.username,
      targetId: item.id,
      targetType: 'YourModel',
      details: { name: body.name },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error('Error creating item:', error);
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 });
  }
}
```

### 2. Add Dynamic Route (Optional)

For individual item operations, create `my-app/app/api/admin/your-feature/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const item = await prisma.yourModel.findUnique({
      where: { id },
    });

    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ item });
  } catch (error) {
    console.error('Error fetching item:', error);
    return NextResponse.json({ error: 'Failed to fetch item' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  // Similar pattern for updates...
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  // Similar pattern for deletes...
}
```

### 3. Add CSRF Exemption (If Needed)

Only for webhook endpoints. Edit `my-app/lib/csrf-config.ts`:

```typescript
export const csrfExemptPaths = [
  '/api/webhooks/your-webhook',
];
```

### 4. Verify

```bash
cd my-app && npm run build
```

## API Patterns

| Pattern | Example |
|---------|---------|
| List endpoint | `GET /api/admin/your-feature` |
| Create endpoint | `POST /api/admin/your-feature` |
| Get single item | `GET /api/admin/your-feature/[id]` |
| Update item | `PATCH /api/admin/your-feature/[id]` |
| Delete item | `DELETE /api/admin/your-feature/[id]` |
| Action on item | `POST /api/admin/your-feature/[id]/action-name` |

## Security Checklist

- [ ] Uses `checkAdminAuthWithRateLimit()` for admin routes
- [ ] Validates all input before database operations
- [ ] Logs state changes with `logAuditAction()`
- [ ] Returns generic error messages (no stack traces)
- [ ] Uses parameterized queries (Prisma handles this)
