-- 0007 — Optional dev seed
--
-- Only runs when the lakebridge.sources table is empty — safe to apply in
-- any environment without clobbering real configuration. Drop these IDs and
-- you'll re-seed on the next migrate.

IF NOT EXISTS (SELECT 1 FROM lakebridge.sources)
BEGIN
    INSERT INTO lakebridge.sources
        (id, host, port, sid, oracle_version, username, secret_ref, tls_required, pool_size, status, created_by, updated_by)
    VALUES
        (N'IFS-PRD-EU', N'ifs-prd-eu.corp.local', 1521, N'IFSPROD', N'19c', N'IFSREADER', N'secret/lakebridge/ifs-reader',    1, 8, N'ok',       N'system', N'system'),
        (N'IFS-PRD-US', N'ifs-prd-us.corp.local', 1521, N'IFSPROD', N'19c', N'IFSREADER', N'secret/lakebridge/ifs-reader-us', 1, 8, N'ok',       N'system', N'system'),
        (N'IFS-TST',    N'ifs-tst.corp.local',    1521, N'IFSTEST', N'19c', N'IFSREADER', N'secret/lakebridge/ifs-reader-tst', 1, 4, N'degraded', N'system', N'system');
END
GO

IF NOT EXISTS (SELECT 1 FROM lakebridge.users)
BEGIN
    INSERT INTO lakebridge.users (sso_subject, email, name, role, mfa_enabled, last_active_at)
    VALUES
        (N'okta|priya.iyer',   N'priya.iyer@corp.local',   N'Priya Iyer',   N'Admin',     1, SYSUTCDATETIME()),
        (N'okta|marcus.hahn',  N'marcus.hahn@corp.local',  N'Marcus Hahn',  N'Operator',  1, DATEADD(MINUTE, -14, SYSUTCDATETIME())),
        (N'okta|jules.okafor', N'jules.okafor@corp.local', N'Jules Okafor', N'Operator',  1, DATEADD(HOUR,    -1, SYSUTCDATETIME())),
        (N'okta|linnea.berg',  N'linnea.berg@corp.local',  N'Linnea Berg',  N'Operator',  0, DATEADD(DAY,     -1, SYSUTCDATETIME())),
        (N'okta|tom.mwangi',   N'tom.mwangi@corp.local',   N'Tom Mwangi',   N'Read-only', 1, DATEADD(DAY,     -1, SYSUTCDATETIME()));
END
GO
