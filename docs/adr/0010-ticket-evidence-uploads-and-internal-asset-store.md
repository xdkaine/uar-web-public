# ADR-0010: Ticket evidence uploads and the internal asset store

Status: Accepted

## Context

Support tickets are text-only. Evidence (screenshots of errors, export dialogs, permission warnings) arrives out-of-band or not at all. The operator requirement: users upload images on tickets; stored files must never be publicly reachable - access flows exclusively through a protected portal route that verifies the requester can view the ticket in the first place.

Ticket-view authorization already exists and is group-aware: creator, live-verified administrators, and active assignees (direct user or AD-group membership via fresh directory snapshots with stale-snapshot live fallback; ADR-0007). Tickets may also be filed "on behalf of" an approved group (`requestedForGroupDn`); members of that group should be able to see the evidence for a ticket about their own group.

## Decision

**Dedicated internal asset container.** Compose gains an `asset-store` service (nginx) that owns a dedicated volume for uploaded evidence. It publishes no ports to the host; it is reachable only on the internal compose network. The Next.js app remains the single ingress for both writes and reads.

1. **Upload path**: `POST /api/support/tickets/{id}/attachments` accepts multipart form data behind the existing support-session gate plus ticket-mutation access (creator, admin, or active assignee). Limits: allowlisted content types (png/jpeg/webp/pdf), per-file size cap, per-ticket file count cap, total-size guard via body limit. The server derives the storage key (cuid + extension allowlist) - client-supplied filenames are metadata only, never path components.
2. **Write transport**: when `ASSET_SERVICE_URL` is configured the app forwards bytes to `asset-store /ingest/{key}` presenting the shared `ASSET_SHARED_SECRET` header; without it, a local-volume driver under a non-public data directory keeps development working. The driver interface is the seam ADR-0009-style extraction would later use.
3. **Read path**: attachments stream through `GET .../attachments/{attachmentId}/content`, which re-verifies ticket view access on every request: creator, verified admin, active assignee, OR member of the ticket's requested-for group (same snapshot freshness/live-fallback rule as assignee access; failures fail closed). Responses are private (no shared caches), inline by allowlisted type, original filename sanitized into `Content-Disposition`. There is no route that serves assets without a ticket authorization decision.
4. **Integrity and audit**: uploads record sha256, size, content type, uploader, and storage key (`TicketAttachment`). Uploads and denied read attempts land in audit logs without file contents. Deletion follows retention policy later; rows are never orphaned silently - the ticket cascade owns them.
5. **Abuse monitoring**: the asset container logs every request line; its volume is separate from database volumes so operators can size, back up, and inspect it independently. Per-user rate limits apply to uploads.

**Access-request comment evidence.** Administrator request comments reuse the same private asset-store boundary and rich-text pipeline. Pasted, dropped, or selected images are staged in the browser, malware-scanned before storage, linked to the newly created `RequestComment`, and served only through an `access_requests.read`-guarded content route that verifies the request/comment/attachment relationship and stored SHA-256. The first scope is image evidence only, capped at five images per comment and 20 MB per image; executable, document, and archive uploads remain on the support-ticket evidence surface.

## Consequences

- Evidence is only reachable through the portal's authorization logic even if the asset container is compromised at the network layer, because it neither understands sessions nor serves anything but opaque keyed objects.
- Two new operational pieces exist: the shared secret (environment-only, like other credentials) and the asset volume (backup/retention become explicit operator duties).
- Requested-for-group members gain read-only evidence visibility; they still cannot respond or change status unless separately assigned.

## Alternatives considered

- Serve files from `public/` or an app-local folder: rejected - unauthenticated static delivery defeats the core requirement.
- Object storage (MinIO/S3) now: deferred - correct at larger scale but adds a credential/service surface before volume-based usage justifies it; the driver seam keeps the move cheap.
- Store blobs in Postgres: rejected - bloats backups/replication for binary payloads and couples DB health to evidence availability.
