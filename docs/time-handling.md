# Time handling

## Exact dates and times

The shared `my-app/components/DateTimePicker.tsx` uses the operator's browser timezone, displays its IANA name and the selected date's UTC offset, and shows the equivalent UTC timestamp. It emits an ISO timestamp ending in `Z`. For example, September 12, 2026 at noon in America/Los_Angeles is `2026-09-12T19:00:00.000Z`. Browser and server timezones therefore need not match.

Spring-forward times that do not exist are rejected. A newly entered repeated fall-back hour uses JavaScript's earlier occurrence; the displayed offset and UTC equivalent identify that occurrence. Opening and confirming an existing timestamp preserves its occurrence, including the later repeated hour. The picker does not offer an occurrence selector.

| Flow | Input and persistence | Enforcement |
| --- | --- | --- |
| Events | EventManagementTab retains the existing ISO value and sends UTC to `/api/admin/events`. `Event.endDate` is a Prisma DateTime. | Portal event metadata; separate from directory-account expiration. `isActive` is a separate flag. |
| External account provisioning and update | accountDraftState retains the saved instant; accountSetupActions converts drafts to UTC before credential-save/update requests. | `AccessRequest.accountExpiresAt` is passed to the LDAP expiration setter. |
| Batch accounts | Shared picker emits UTC; batch creation records `accountExpiresAt` and applies any configured AD expiration, internal or external. | AD enforces directory expiry; VPN expiry is a separate portal record. Enabling AD changes the disabled bit, not accountExpires. |
| Notification banners | Start/end picker values and edit values retain UTC. | `/api/settings/banner` compares start/end with the current instant. |
| Offboard extensions/reminders | Shared picker values are converted to ISO before submission. | Jobs compare stored deadlines with current time; a scheduler may act after the cutoff on its next run. |
| Audit-log time filters | Shared picker emits UTC to `/api/admin/logs`. | Inclusive timestamp bounds against createdAt. |

AD `accountExpires` is a count of 100-nanosecond intervals since 1601-01-01 UTC. The LDAP setter converts the JavaScript Date's epoch milliseconds to that value. AD's display timezone is not an input to this conversion. See [Microsoft's attribute definition](https://learn.microsoft.com/en-us/windows/win32/adschema/a-accountexpires).

Prisma DateTime fields carry application instants; they do not record the operator's original IANA timezone. No database migration or historical timestamp rewrite is part of this change. APIs currently also accept legacy offsetless strings; direct API clients must send `Z` or an explicit offset to avoid server-local interpretation.

## Other representations and limits

- Workbook import (`lib/batch-account-workbook.ts`) runs in the browser. Explicit-offset ISO text preserves the instant; offsetless datetime text uses the importing browser's timezone. Date-only ISO text means UTC midnight. Excel date cells are currently treated as the UTC Date supplied by ExcelJS. Use explicit-offset ISO text for unambiguous expiration imports; Excel cells do not identify a timezone. This legacy distinction remains and is not silently reinterpreted by this picker fix.
- Date-only controls, including support-ticket filters, express calendar dates rather than a chosen time. They are not covered by the exact-time picker contract.
- Offboarding day offsets use elapsed 24-hour periods (`offboard-campaign.ts`), not local calendar days. Token/session/lease lifetimes similarly use elapsed durations. Crossing DST can change the displayed wall-clock hour.
- ClientLocalDate and several detail/list views use the viewer's local formatting. Some render only a calendar date. Server-generated email text uses server locale formatting in several paths; some include a timezone abbreviation and others only a date. These presentation paths are not uniformly converted to named-local-plus-UTC by this change.
- No live portal, database, AD timezone configuration, or historical timestamps were inspected. Existing records may already reflect an earlier offsetless submission and require an individually reviewed correction; they cannot be repaired safely by applying a blanket offset.

## Regression checks

From `my-app`, run `npm run test:run` and `node e2e/components/check-date-time.mjs`. The browser fixture uses the real picker and CSS without external services. It checks desktop/mobile minute-list bounds, last-minute selection, UTC serialization in Los Angeles/UTC/Kolkata, and rejection of the spring-forward gap.
