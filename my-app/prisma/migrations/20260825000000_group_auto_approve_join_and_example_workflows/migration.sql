-- Group auto-approve flag + seeded example workflow graphs (ADR-0013).
--
-- 1. AllowedTicketSubjectGroup.autoApproveJoin: policy gate that lets a
--    published workflow enqueue group adds only for groups explicitly
--    configured to be added automatically.
-- 2. Three DRAFT, DISABLED example graphs so operators can review real
--    workflows in the canvas before publishing:
--      - "Auto group join (account issues)"  ticket_created
--      - "Directory outage escalation"       dc_unreachable
--      - "Directory recovery cleanup"        dc_recovered
--
-- Rollback:
--   DELETE FROM "WorkflowGraph" WHERE "name" IN (
--     'Auto group join (account issues)',
--     'Directory outage escalation',
--     'Directory recovery cleanup');
--   ALTER TABLE "AllowedTicketSubjectGroup" DROP COLUMN IF EXISTS "autoApproveJoin";

ALTER TABLE "AllowedTicketSubjectGroup" ADD COLUMN "autoApproveJoin" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Example 1: ticket created -> ACCOUNT + filed-for-self + auto-approve config
-- -> queue lifecycle group add -> system reply -> move to in_progress.
-- --------------------------------------------------------------------------
INSERT INTO "WorkflowGraph" ("id", "createdAt", "updatedAt", "name", "description", "triggerKey", "nodes", "edges", "status", "version", "enabled", "createdBy", "updatedBy")
VALUES (
  'flowseed_autojoin01',
  NOW(), NOW(),
  'Auto group join (account issues)',
  'When an account-issue ticket is filed by the requester for themselves, and the requested group is flagged for automatic adds, queue the lifecycle group add, confirm on the ticket, and set it in progress.',
  'ticket_created',
  '[
    { "id": "t1", "type": "trigger_ticket_created", "config": {}, "position": { "x": 0, "y": 200 } },
    { "id": "c1", "type": "logic_condition", "config": { "field": "category", "equals": "ACCOUNT" }, "position": { "x": 220, "y": 200 } },
    { "id": "c2", "type": "logic_condition", "config": { "field": "requestedForSelf", "equals": "true" }, "position": { "x": 440, "y": 200 } },
    { "id": "c3", "type": "logic_condition", "config": { "field": "joinAutoApprove", "equals": "true" }, "position": { "x": 660, "y": 200 } },
    { "id": "a1", "type": "action_enqueue_group_add", "config": { "groupDn": "{{joinGroupDn}}" }, "position": { "x": 880, "y": 200 } },
    { "id": "a2", "type": "action_add_ticket_response", "config": { "message": "Your membership request for {{joinGroupDn}} has been queued automatically. This ticket stays open until provisioning completes." }, "position": { "x": 1100, "y": 200 } },
    { "id": "a3", "type": "action_update_ticket", "config": { "status": "in_progress" }, "position": { "x": 1320, "y": 200 } }
  ]'::jsonb,
  '[
    { "id": "e1", "source": "t1", "target": "c1" },
    { "id": "e2", "source": "c1", "sourceHandle": "true", "target": "c2" },
    { "id": "e3", "source": "c2", "sourceHandle": "true", "target": "c3" },
    { "id": "e4", "source": "c3", "sourceHandle": "true", "target": "a1" },
    { "id": "e5", "source": "a1", "target": "a2" },
    { "id": "e6", "source": "a2", "target": "a3" }
  ]'::jsonb,
  'draft', 1, false, 'seed', 'seed'
)
ON CONFLICT ("name", "version") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Example 2: primary AD unreachable -> bounded wait -> service alert +
-- global banner + email notification.
-- --------------------------------------------------------------------------
INSERT INTO "WorkflowGraph" ("id", "createdAt", "updatedAt", "name", "description", "triggerKey", "nodes", "edges", "status", "version", "enabled", "createdBy", "updatedBy")
VALUES (
  'flowseed_outage02',
  NOW(), NOW(),
  'Directory outage escalation',
  'After the directory has been unreachable for 10 minutes, raise a persistent service alert, show a site-wide banner, and email the operations list. The wait filters transient blips; recovery is handled by the companion cleanup workflow.',
  'dc_unreachable',
  '[
    { "id": "t1", "type": "trigger_dc_unreachable", "config": {}, "position": { "x": 0, "y": 200 } },
    { "id": "w1", "type": "logic_delay", "config": { "minutes": 10 }, "position": { "x": 240, "y": 200 } },
    { "id": "a1", "type": "action_create_service_alert", "config": { "dedupeKey": "directory-outage", "severity": "critical", "title": "Primary AD unreachable", "message": "The directory health probe could not reach any configured server for over 10 minutes. Target: {{target}}." }, "position": { "x": 480, "y": 120 } },
    { "id": "a2", "type": "action_create_notification_banner", "config": { "message": "Authentication may be degraded: the primary directory is unreachable. Engineers are investigating.", "type": "warning", "expiresMinutes": 240 }, "position": { "x": 480, "y": 320 } },
    { "id": "a3", "type": "action_send_email", "config": { "to": "ops@example.org", "subject": "[ALERT] Directory outage detected", "body": "The directory probe failed for {{target}}: {{error}}. A service alert and site banner are active." }, "position": { "x": 720, "y": 320 } }
  ]'::jsonb,
  '[
    { "id": "e1", "source": "t1", "target": "w1" },
    { "id": "e2", "source": "w1", "target": "a1" },
    { "id": "e3", "source": "a1", "target": "a2" },
    { "id": "e4", "source": "a2", "target": "a3" }
  ]'::jsonb,
  'draft', 1, false, 'seed', 'seed'
)
ON CONFLICT ("name", "version") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Example 3: directory recovered -> resolve alerts, cascade-clear banners,
-- post an all-clear banner for the day.
-- --------------------------------------------------------------------------
INSERT INTO "WorkflowGraph" ("id", "createdAt", "updatedAt", "name", "description", "triggerKey", "nodes", "edges", "status", "version", "enabled", "createdBy", "updatedBy")
VALUES (
  'flowseed_recover03',
  NOW(), NOW(),
  'Directory recovery cleanup',
  'Companion to the outage escalation: when the directory answers again after an active failure alert, resolve alerts, cascade-clear the banners this automation raised, and announce recovery.',
  'dc_recovered',
  '[
    { "id": "t1", "type": "trigger_dc_recovered", "config": {}, "position": { "x": 0, "y": 200 } },
    { "id": "a1", "type": "action_resolve_service_alerts", "config": { "category": "directory" }, "position": { "x": 260, "y": 200 } },
    { "id": "a2", "type": "action_create_notification_banner", "config": { "message": "Directory connectivity restored. If you still see issues, please submit a support ticket.", "type": "success", "expiresMinutes": 120 }, "position": { "x": 520, "y": 200 } }
  ]'::jsonb,
  '[
    { "id": "e1", "source": "t1", "target": "a1" },
    { "id": "e2", "source": "a1", "target": "a2" }
  ]'::jsonb,
  'draft', 1, false, 'seed', 'seed'
)
ON CONFLICT ("name", "version") DO NOTHING;
