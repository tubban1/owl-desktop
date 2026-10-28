-- One-time migration applied to production D1 owl-support-cases on 2026-10-28.
-- Existing support_cases data is preserved. Do not re-run ALTER TABLE lines after applied.
CREATE TABLE IF NOT EXISTS support_case_events (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES support_cases(id),
 event_type TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'system',
 detail TEXT, from_state TEXT, to_state TEXT,
 request_id TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_support_events_case_time ON support_case_events(case_id,created_at);
CREATE TABLE IF NOT EXISTS support_case_outbox (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES support_cases(id),
 idempotency_key TEXT NOT NULL UNIQUE, recipient TEXT NOT NULL, subject TEXT NOT NULL,
 body_sha256 TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('prepared','sending','sent','uncertain','rejected')),
 provider_message_id TEXT, actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT,
 last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_support_outbox_case_time ON support_case_outbox(case_id,created_at);
ALTER TABLE support_cases ADD COLUMN assigned_to TEXT;
ALTER TABLE support_cases ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE support_cases ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE support_cases ADD COLUMN last_action_at TEXT;
ALTER TABLE support_cases ADD COLUMN resolution_summary TEXT;
ALTER TABLE support_cases ADD COLUMN closed_at TEXT;
ALTER TABLE support_case_outbox ADD COLUMN body_text TEXT;
ALTER TABLE support_case_outbox ADD COLUMN reply_to TEXT;
CREATE INDEX IF NOT EXISTS idx_support_outbox_ready ON support_case_outbox(status,created_at);
CREATE TRIGGER IF NOT EXISTS trg_support_case_created AFTER INSERT ON support_cases BEGIN
 INSERT INTO support_case_events(id,case_id,event_type,actor,detail,to_state)
 VALUES (lower(hex(randomblob(16))),NEW.id,'created','system:email-routing',
 json_object('category',NEW.category,'recipient',NEW.recipient,'ack_status',NEW.ack_status),NEW.state);
END;
CREATE TRIGGER IF NOT EXISTS trg_support_case_state_change AFTER UPDATE OF state ON support_cases WHEN OLD.state <> NEW.state BEGIN
 INSERT INTO support_case_events(id,case_id,event_type,actor,from_state,to_state,detail)
 VALUES (lower(hex(randomblob(16))),NEW.id,'state_changed','system:db-trigger',OLD.state,NEW.state,json_object('assigned_to',NEW.assigned_to));
END;
CREATE TRIGGER IF NOT EXISTS trg_support_case_assignee_change AFTER UPDATE OF assigned_to ON support_cases WHEN COALESCE(OLD.assigned_to,'') <> COALESCE(NEW.assigned_to,'') BEGIN
 INSERT INTO support_case_events(id,case_id,event_type,actor,detail)
 VALUES (lower(hex(randomblob(16))),NEW.id,'assignee_changed','system:db-trigger',json_object('from',OLD.assigned_to,'to',NEW.assigned_to));
END;
CREATE TRIGGER IF NOT EXISTS trg_support_outbox_insert AFTER INSERT ON support_case_outbox BEGIN
 INSERT INTO support_case_events(id,case_id,event_type,actor,detail,request_id)
 VALUES (lower(hex(randomblob(16))),NEW.case_id,'reply_queued',NEW.actor,
 json_object('outbox_id',NEW.id,'recipient',NEW.recipient,'subject',NEW.subject),'outbox_created:'||NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS trg_support_outbox_status AFTER UPDATE OF status ON support_case_outbox WHEN OLD.status<>NEW.status BEGIN
 INSERT INTO support_case_events(id,case_id,event_type,actor,detail,request_id)
 VALUES (lower(hex(randomblob(16))),NEW.case_id,'reply_'||NEW.status,'system:mail-dispatcher',
 json_object('outbox_id',NEW.id,'provider_message_id',NEW.provider_message_id,'error',NEW.last_error),
 'outbox_status:'||NEW.id||':'||NEW.status);
END;
CREATE TRIGGER IF NOT EXISTS trg_support_case_ack_change AFTER UPDATE OF ack_status ON support_cases WHEN OLD.ack_status <> NEW.ack_status BEGIN
 INSERT INTO support_case_events(id,case_id,event_type,actor,detail)
 VALUES (lower(hex(randomblob(16))),NEW.id,'ack_status_changed','system:email-routing',
 json_object('from',OLD.ack_status,'to',NEW.ack_status));
END;
INSERT OR IGNORE INTO support_case_events(id,case_id,event_type,actor,detail,to_state,created_at)
SELECT 'baseline-'||id,id,'historical_import','system:migration',
'Existing case when audit was introduced',state,created_at FROM support_cases;
