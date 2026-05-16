-- 0005 — Operators and audit log
--
-- `users` is a thin local mirror of identities Okta has authenticated. We
-- only store what we need to make the Settings/Users screen and the audit
-- log useful — name, email, role, MFA enrolment, last-active. No passwords.
--
-- `audit_log` captures every state-changing operator action: job.run_now,
-- job.disable, source.edit, recon.acknowledge, auth.login, etc. The schema
-- intentionally mirrors the actions/targets the UI's Audit tab renders.

IF OBJECT_ID(N'lakebridge.users', N'U') IS NULL
BEGIN
    CREATE TABLE lakebridge.users (
        id              BIGINT          IDENTITY(1,1) NOT NULL PRIMARY KEY,
        sso_subject     NVARCHAR(200)   NOT NULL,                    -- Okta sub claim
        email           NVARCHAR(200)   NOT NULL,
        name            NVARCHAR(200)   NOT NULL,
        role            NVARCHAR(20)    NOT NULL,
        mfa_enabled     BIT             NOT NULL CONSTRAINT DF_users_mfa DEFAULT 0,
        disabled        BIT             NOT NULL CONSTRAINT DF_users_disabled DEFAULT 0,
        last_active_at  DATETIME2(3)    NULL,
        created_at      DATETIME2(3)    NOT NULL CONSTRAINT DF_users_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_users_email   UNIQUE (email),
        CONSTRAINT UQ_users_subject UNIQUE (sso_subject),
        CONSTRAINT CK_users_role
            CHECK (role IN (N'Admin', N'Operator', N'Read-only'))
    );
END
GO

IF OBJECT_ID(N'lakebridge.audit_log', N'U') IS NULL
BEGIN
    CREATE TABLE lakebridge.audit_log (
        id              BIGINT          IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ts              DATETIME2(3)    NOT NULL CONSTRAINT DF_audit_ts DEFAULT SYSUTCDATETIME(),
        actor           NVARCHAR(200)   NOT NULL,                    -- email or 'scheduler'/'system'
        action          NVARCHAR(60)    NOT NULL,                    -- 'job.run_now', 'source.edit', …
        target          NVARCHAR(400)   NOT NULL,                    -- human-readable target id
        metadata_json   NVARCHAR(MAX)   NULL,                        -- before/after diff, ip, user-agent, etc.
        request_id      NVARCHAR(60)    NULL                         -- correlation id
    );

    CREATE INDEX IX_audit_ts        ON lakebridge.audit_log (ts DESC);
    CREATE INDEX IX_audit_action_ts ON lakebridge.audit_log (action, ts DESC);
    CREATE INDEX IX_audit_actor_ts  ON lakebridge.audit_log (actor, ts DESC);
END
GO
