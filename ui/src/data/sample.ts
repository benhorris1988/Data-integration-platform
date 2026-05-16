// Lakebridge sample data — IFS → SAP ECC staging
// All data is fake and module-scoped. Replace with TanStack Query against the
// orchestrator's API once that exists.

export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type Strategy =
  | 'full_snapshot'
  | 'append'
  | 'watermark_delta'
  | 'truncate_and_load';

export type SourceId = 'IFS-PRD-EU' | 'IFS-PRD-US' | 'IFS-TST';

export type Job = {
  id: string;
  code: string;
  source_object: string;
  target_table: string;
  strategy: Strategy;
  source: SourceId;
  schedule: string;
  status: RunStatus;
  last_run: string;
  rows: number;
  owner: string;
  enabled: boolean;
};

export type RunError = {
  id: string;
  severity: 'error' | 'warn';
  code: string;
  message: string;
  source_pk: string;
  captured_at: string;
  run_id: string;
  job_code: string;
};

export type Source = {
  id: SourceId;
  host: string;
  port: number;
  sid: string;
  oracle: string;
  status: 'ok' | 'degraded' | 'failed';
  lastTest: string;
};

export type TimelineBlock = {
  idx: number;
  status: 'succeeded' | 'warning' | 'failed' | 'running';
  dur_sec: number;
  hour: number;
  job_code: string;
};

export type ReconCell = {
  result: 'ok' | 'warn' | 'fail';
  src_count: number;
  tgt_count: number;
  checksum_match: boolean;
};

export type ReconRow = {
  job: Job;
  cells: ReconCell[];
};

export type AuditEntry = {
  ts: string;
  actor: string;
  action: string;
  target: string;
};

export type SchemaMapping = {
  src: string;
  src_type: string;
  tgt: string;
  tgt_type: string;
  drift: 'cast' | 'new' | null;
};

export type SourceObject = {
  name: string;
  rowcount: number;
  last_seen: string;
  jobs: number;
};

export type User = {
  name: string;
  email: string;
  role: 'Admin' | 'Operator' | 'Read-only';
  last_active: string;
  mfa: boolean;
};

export const SOURCES: Source[] = [
  { id: 'IFS-PRD-EU', host: 'ifs-prd-eu.corp.local', port: 1521, sid: 'IFSPROD', oracle: '19c', status: 'ok',       lastTest: '4 min ago' },
  { id: 'IFS-PRD-US', host: 'ifs-prd-us.corp.local', port: 1521, sid: 'IFSPROD', oracle: '19c', status: 'ok',       lastTest: '12 min ago' },
  { id: 'IFS-TST',    host: 'ifs-tst.corp.local',    port: 1521, sid: 'IFSTEST', oracle: '19c', status: 'degraded', lastTest: '2 hours ago' },
];

export const STRATEGIES: Strategy[] = [
  'full_snapshot',
  'append',
  'watermark_delta',
  'truncate_and_load',
];

type JobSeed = [
  string, string, string, Strategy, SourceId, string, RunStatus, string, number, string,
];

const JOBS_SEED: JobSeed[] = [
  ['EXT.MAT.MASTER.FULL',          'IFSAPP.INVENTORY_PART_TAB',         'stg_ifs_inventory.inventory_part',     'full_snapshot',     'IFS-PRD-EU', '0 6 * * *',     'succeeded', '2 min ago',       1284302, 'Priya Iyer'],
  ['EXT.CUST.MASTER.DELTA',        'IFSAPP.CUSTOMER_INFO',              'stg_ifs_customer.customer_master',     'watermark_delta',   'IFS-PRD-EU', '*/15 * * * *',  'running',   '34 sec ago',      18420,   'Marcus Hahn'],
  ['EXT.PO.LINES.APPEND',          'IFSAPP.PURCHASE_ORDER_LINE_TAB',    'stg_ifs_purchase.po_line_history',     'append',            'IFS-PRD-EU', '0 */2 * * *',   'succeeded', '14 min ago',      62110,   'Jules Okafor'],
  ['EXT.CO.HISTORY.WMARK',         'IAL.CUSTOMER_ORDER_HIST',           'stg_ifs_sales.co_history',             'watermark_delta',   'IFS-PRD-EU', '*/15 * * * *',  'failed',    '6 min ago',       9320,    'Linnea Berg'],
  ['EXT.SUPP.MASTER.FULL',         'IFSAPP.SUPPLIER_INFO',              'stg_ifs_supplier.supplier_master',     'full_snapshot',     'IFS-PRD-EU', '0 6 * * *',     'succeeded', 'yesterday 14:22', 48201,   'Tom Mwangi'],
  ['EXT.INV.BAL.SNAPSHOT',         'IFSAPP.INVENTORY_PART_IN_STOCK',    'stg_ifs_inventory.inv_balance',        'truncate_and_load', 'IFS-PRD-EU', '0 */2 * * *',   'succeeded', '1 hour ago',      742188,  'Priya Iyer'],
  ['EXT.MAT.MASTER.FULL.US',       'IFSAPP.INVENTORY_PART_TAB',         'stg_ifs_inventory.inventory_part_us',  'full_snapshot',     'IFS-PRD-US', '0 7 * * *',     'succeeded', '3 hours ago',     982410,  'Marcus Hahn'],
  ['EXT.CUST.MASTER.DELTA.US',     'IFSAPP.CUSTOMER_INFO',              'stg_ifs_customer.customer_master_us',  'watermark_delta',   'IFS-PRD-US', '*/15 * * * *',  'succeeded', '4 min ago',       2104,    'Jules Okafor'],
  ['EXT.PO.LINES.APPEND.US',       'IFSAPP.PURCHASE_ORDER_LINE_TAB',    'stg_ifs_purchase.po_line_history_us',  'append',            'IFS-PRD-US', '0 */2 * * *',   'succeeded', '18 min ago',      31402,   'Linnea Berg'],
  ['EXT.CO.LINES.APPEND',          'IFSAPP.CUSTOMER_ORDER_LINE_TAB',    'stg_ifs_sales.co_line_history',        'append',            'IFS-PRD-EU', '0 */2 * * *',   'succeeded', '22 min ago',      141029,  'Tom Mwangi'],
  ['EXT.WORK.ORDER.WMARK',         'IFSAPP.SHOP_ORD',                   'stg_ifs_mfg.work_order',               'watermark_delta',   'IFS-PRD-EU', '*/30 * * * *',  'queued',    'pending',         0,       'Priya Iyer'],
  ['EXT.GL.ACCOUNT.FULL',          'IFSAPP.ACCOUNT',                    'stg_ifs_finance.gl_account',           'full_snapshot',     'IFS-PRD-EU', '0 4 * * *',     'succeeded', 'yesterday 04:00', 14820,   'Marcus Hahn'],
  ['EXT.CURRENCY.RATE.FULL',       'IFSAPP.CURRENCY_RATE',              'stg_ifs_finance.fx_rate',              'truncate_and_load', 'IFS-PRD-EU', '0 5 * * *',     'succeeded', 'yesterday 05:00', 9412,    'Jules Okafor'],
  ['EXT.SHIP.ADDR.DELTA',          'IFSAPP.CUST_ORDER_ADDRESS',         'stg_ifs_sales.ship_address',           'watermark_delta',   'IFS-PRD-EU', '*/15 * * * *',  'succeeded', '7 min ago',       3140,    'Linnea Berg'],
  ['EXT.INVOICE.HEADER.APPEND',    'IFSAPP.CUSTOMER_ORDER_INV_HEAD',    'stg_ifs_sales.invoice_header',         'append',            'IFS-PRD-EU', '0 */1 * * *',   'succeeded', '40 min ago',      88204,   'Tom Mwangi'],
  ['EXT.INVOICE.LINE.APPEND',      'IFSAPP.CUSTOMER_ORDER_INV_ITEM',    'stg_ifs_sales.invoice_line',           'append',            'IFS-PRD-EU', '0 */1 * * *',   'failed',    '38 min ago',      72401,   'Priya Iyer'],
  ['EXT.PART.SUPPLIER.FULL',       'IFSAPP.PURCHASE_PART_SUPPLIER',     'stg_ifs_purchase.part_supplier',       'full_snapshot',     'IFS-PRD-EU', '0 7 * * *',     'succeeded', '5 hours ago',     204318,  'Marcus Hahn'],
  ['EXT.WAREHOUSE.FULL',           'IFSAPP.SITE',                       'stg_ifs_inventory.warehouse',          'full_snapshot',     'IFS-PRD-EU', '0 3 * * *',     'succeeded', 'yesterday 03:00', 412,     'Jules Okafor'],
  ['EXT.UOM.FULL',                 'IFSAPP.ISO_UNIT',                   'stg_ifs_meta.uom',                     'full_snapshot',     'IFS-PRD-EU', '0 3 * * *',     'succeeded', 'yesterday 03:01', 281,     'Linnea Berg'],
  ['EXT.PROJECT.WMARK',            'IFSAPP.PROJECT',                    'stg_ifs_pm.project',                   'watermark_delta',   'IFS-PRD-EU', '0 */1 * * *',   'succeeded', '53 min ago',      1840,    'Tom Mwangi'],
  ['EXT.ACTIVITY.WMARK',           'IFSAPP.ACTIVITY',                   'stg_ifs_pm.activity',                  'watermark_delta',   'IFS-PRD-EU', '0 */1 * * *',   'succeeded', '53 min ago',      12048,   'Priya Iyer'],
  ['EXT.EMPLOYEE.FULL',            'IFSAPP.COMPANY_PERS',               'stg_ifs_hr.employee',                  'full_snapshot',     'IFS-PRD-EU', '0 4 * * *',     'cancelled', 'yesterday 04:11', 0,       'Marcus Hahn'],
  ['EXT.COSTCENTER.FULL',          'IFSAPP.ACCOUNTING_CODE_PART_C',     'stg_ifs_finance.cost_center',          'full_snapshot',     'IFS-PRD-EU', '0 4 * * *',     'succeeded', 'yesterday 04:12', 1841,    'Jules Okafor'],
  ['EXT.ORDER.TYPE.FULL',          'IFSAPP.CUSTOMER_ORDER_TYPE',        'stg_ifs_sales.order_type',             'full_snapshot',     'IFS-PRD-EU', '0 3 * * *',     'succeeded', 'yesterday 03:02', 142,     'Linnea Berg'],
  ['EXT.TAX.CODE.FULL',            'IFSAPP.STATUTORY_FEE',              'stg_ifs_finance.tax_code',             'full_snapshot',     'IFS-PRD-EU', '0 3 * * *',     'succeeded', 'yesterday 03:03', 318,     'Tom Mwangi'],
  ['EXT.PAYMENT.TERM.FULL',        'IFSAPP.PAYMENT_TERM',               'stg_ifs_finance.payment_term',         'full_snapshot',     'IFS-PRD-EU', '0 3 * * *',     'succeeded', 'yesterday 03:04', 92,      'Priya Iyer'],
  ['EXT.PART.CATALOG.WMARK',       'IFSAPP.PART_CATALOG',               'stg_ifs_inventory.part_catalog',       'watermark_delta',   'IFS-PRD-EU', '0 */2 * * *',   'succeeded', '1 hour ago',      408120,  'Marcus Hahn'],
  ['EXT.CO.HISTORY.WMARK.TST',     'IAL.CUSTOMER_ORDER_HIST',           'stg_ifs_sales.co_history_tst',         'watermark_delta',   'IFS-TST',    'manual',        'failed',    '2 hours ago',     0,       'Jules Okafor'],
];

export const JOBS: Job[] = JOBS_SEED.map((r, i) => ({
  id: 'job_' + String(i + 1).padStart(3, '0'),
  code: r[0],
  source_object: r[1],
  target_table: r[2],
  strategy: r[3],
  source: r[4],
  schedule: r[5],
  status: r[6],
  last_run: r[7],
  rows: r[8],
  owner: r[9],
  enabled: r[6] !== 'cancelled',
}));

type ErrorSeed = ['error' | 'warn', string, string, string, string];

const ERRORS_SEED: ErrorSeed[] = [
  ['error', 'ORA-12541',           'TNS: no listener — connection refused at ifs-prd-eu.corp.local:1521', 'CO-44102873', '34 sec ago'],
  ['error', 'LB-CAST-FAIL',        'Numeric overflow casting NUMBER(22,6) → DECIMAL(18,4) on column NET_AMOUNT', 'CO-44102861', '1 min ago'],
  ['error', 'LB-SCHEMA-DRIFT',     'Source column ORDER_NO width changed 12 → 20; staging column truncates', 'CO-44102844', '2 min ago'],
  ['warn',  'LB-ROWHASH-MISMATCH', 'Reconciliation hash differs on 14 rows; rerun recommended', 'CO-44102801', '3 min ago'],
  ['error', 'ORA-01017',           'Invalid username/password; logon denied for IFSREADER', '—', '4 min ago'],
  ['error', 'LB-WMARK-REGRESS',    'Watermark value 2026-05-15T11:00:00Z is earlier than last successful 2026-05-15T11:15:00Z', '—', '6 min ago'],
  ['error', 'LB-CONN-LOST',        'Connection closed mid-fetch after 42,118 rows; retried 0/3', 'CO-44102704', '8 min ago'],
  ['warn',  'LB-CAST-FAIL',        'Implicit cast VARCHAR2(4000) → NVARCHAR(MAX) on column DESCRIPTION', 'IP-9921044', '11 min ago'],
  ['error', 'LB-ROWHASH-MISMATCH', 'Checksum drift on stg_ifs_sales.co_history (run #4421)', '—', '14 min ago'],
  ['error', 'ORA-12541',           'TNS: no listener — initial connection failed', '—', '18 min ago'],
  ['warn',  'LB-SCHEMA-DRIFT',     'New nullable column ADDED_BY appeared in IFSAPP.CUSTOMER_INFO', '—', '22 min ago'],
  ['error', 'LB-CAST-FAIL',        'Date out of range: 0001-01-01 not representable in target', 'CI-7711', '28 min ago'],
  ['error', 'LB-CONN-LOST',        'TCP reset by peer during fetchmany() at offset 188,420', '—', '34 min ago'],
  ['warn',  'LB-ROWHASH-MISMATCH', 'Hash drift on 2 rows in stg_ifs_inventory.inventory_part', '—', '41 min ago'],
];

export const ERRORS: RunError[] = ERRORS_SEED.map((e, i) => ({
  id: 'err_' + (10000 + i),
  severity: e[0],
  code: e[1],
  message: e[2],
  source_pk: e[3],
  captured_at: e[4],
  run_id: 'run_' + (8000 + (i % 12)),
  job_code: JOBS[i % JOBS.length].code,
}));

export const STEPS = ['connect', 'count', 'extract', 'load', 'recon', 'finalize'] as const;

export const TIMELINE_BLOCKS: TimelineBlock[] = Array.from({ length: 60 }, (_, i) => {
  const seed = (i * 9301 + 49297) % 233280;
  const r = seed / 233280;
  let status: TimelineBlock['status'] = 'succeeded';
  if (r > 0.95) status = 'failed';
  else if (r > 0.86) status = 'warning';
  else if (r > 0.78) status = 'running';
  const dur = 30 + Math.floor(r * 240);
  return { idx: i, status, dur_sec: dur, hour: Math.floor(i / 2.5), job_code: JOBS[i % JOBS.length].code };
});

export const SPARK_RUNS = [42, 38, 55, 49, 61, 58, 72, 66, 71, 80, 77, 84, 92, 88, 95, 101, 98, 104, 112, 108];
export const SPARK_SUCC = [97, 97, 98, 96, 97, 98, 99, 98, 97, 98, 98, 99, 99, 98, 98, 99, 99, 98, 98, 99];
export const SPARK_ROWS = [120, 140, 180, 160, 210, 200, 260, 240, 280, 310, 300, 340, 360, 340, 400, 420, 410, 460, 480, 470];
export const SPARK_ACTIVE = [12, 13, 13, 14, 14, 14, 14, 15, 15, 15, 15, 15, 15, 16, 16, 16, 17, 17, 17, 18];

export const RPS_SERIES = Array.from({ length: 60 }, (_, i) => {
  const v = 8200 + Math.sin(i / 4) * 1200 + Math.cos(i / 9) * 900 + i * 40;
  return Math.round(v);
});

export const RECON: ReconRow[] = JOBS.slice(0, 14).map((j, i) => {
  const cells: ReconCell[] = Array.from({ length: 6 }, (_, k) => {
    const seed = ((i + 1) * 17 + (k + 1) * 7) % 100;
    let result: ReconCell['result'] = 'ok';
    if (seed > 92) result = 'fail';
    else if (seed > 80) result = 'warn';
    const src = 100000 + ((i * 9301 + k * 409) % 800000);
    return {
      result,
      src_count: src,
      tgt_count: src - (result === 'fail' ? 142 : result === 'warn' ? 14 : 0),
      checksum_match: result === 'ok',
    };
  });
  return { job: j, cells };
});

export const USERS: User[] = [
  { name: 'Priya Iyer',   email: 'priya.iyer@corp.local',   role: 'Admin',     last_active: '2 min ago',  mfa: true },
  { name: 'Marcus Hahn',  email: 'marcus.hahn@corp.local',  role: 'Operator',  last_active: '14 min ago', mfa: true },
  { name: 'Jules Okafor', email: 'jules.okafor@corp.local', role: 'Operator',  last_active: '1 hour ago', mfa: true },
  { name: 'Linnea Berg',  email: 'linnea.berg@corp.local',  role: 'Operator',  last_active: 'yesterday',  mfa: false },
  { name: 'Tom Mwangi',   email: 'tom.mwangi@corp.local',   role: 'Read-only', last_active: 'yesterday',  mfa: true },
];

export const AUDIT: AuditEntry[] = (
  [
    ['2026-05-16 14:42:11', 'priya.iyer',   'job.run_now',      'EXT.MAT.MASTER.FULL'],
    ['2026-05-16 14:38:02', 'marcus.hahn',  'source.edit',      'IFS-PRD-EU host=ifs-prd-eu.corp.local'],
    ['2026-05-16 14:21:55', 'priya.iyer',   'job.disable',      'EXT.CO.HISTORY.WMARK.TST'],
    ['2026-05-16 13:50:14', 'jules.okafor', 'job.create',       'EXT.PART.CATALOG.WMARK'],
    ['2026-05-16 13:11:08', 'linnea.berg',  'auth.login',       'sso=okta'],
    ['2026-05-16 12:42:00', 'marcus.hahn',  'job.run_now',      'EXT.CUST.MASTER.DELTA'],
    ['2026-05-16 11:58:33', 'priya.iyer',   'user.role.change', 'tom.mwangi → Read-only'],
    ['2026-05-16 11:01:42', 'jules.okafor', 'recon.acknowledge','stg_ifs_sales.co_history'],
    ['2026-05-16 10:34:21', 'marcus.hahn',  'job.edit',         'EXT.INVOICE.LINE.APPEND schedule=0 */1 * * *'],
    ['2026-05-16 09:12:00', 'priya.iyer',   'auth.login',       'sso=okta'],
  ] as const
).map((r) => ({ ts: r[0], actor: r[1], action: r[2], target: r[3] }));

export const SCHEMA_MAP: SchemaMapping[] = [
  { src: 'PART_NO',         src_type: 'VARCHAR2(25)',  tgt: 'part_no',         tgt_type: 'nvarchar(25)',  drift: null },
  { src: 'DESCRIPTION',     src_type: 'VARCHAR2(200)', tgt: 'description',     tgt_type: 'nvarchar(200)', drift: null },
  { src: 'UNIT_MEAS',       src_type: 'VARCHAR2(10)',  tgt: 'unit_meas',       tgt_type: 'nvarchar(10)',  drift: null },
  { src: 'GROSS_WEIGHT',    src_type: 'NUMBER(15,6)',  tgt: 'gross_weight',    tgt_type: 'decimal(15,6)', drift: null },
  { src: 'NET_WEIGHT',      src_type: 'NUMBER(15,6)',  tgt: 'net_weight',      tgt_type: 'decimal(15,6)', drift: null },
  { src: 'PART_STATUS',     src_type: 'VARCHAR2(1)',   tgt: 'part_status',     tgt_type: 'nchar(1)',      drift: null },
  { src: 'PLANNER_BUYER',   src_type: 'VARCHAR2(20)',  tgt: 'planner_buyer',   tgt_type: 'nvarchar(20)',  drift: null },
  { src: 'CONFIGURABLE_DB', src_type: 'VARCHAR2(20)',  tgt: 'configurable_db', tgt_type: 'nvarchar(20)',  drift: null },
  { src: 'ROWVERSION',      src_type: 'NUMBER',        tgt: 'rowversion',      tgt_type: 'bigint',        drift: null },
  { src: 'CONTRACT',        src_type: 'VARCHAR2(5)',   tgt: 'contract',        tgt_type: 'nvarchar(5)',   drift: null },
  { src: 'CREATED_BY',      src_type: 'VARCHAR2(30)',  tgt: 'created_by',      tgt_type: 'nvarchar(30)',  drift: null },
  { src: 'CREATED_DATE',    src_type: 'DATE',          tgt: 'created_date',    tgt_type: 'datetime2(0)',  drift: null },
  { src: 'MODIFIED_DATE',   src_type: 'DATE',          tgt: 'modified_date',   tgt_type: 'datetime2(0)',  drift: null },
  { src: 'STD_COST',        src_type: 'NUMBER(22,6)',  tgt: 'std_cost',        tgt_type: 'decimal(18,4)', drift: 'cast' },
  { src: 'PROVIDE',         src_type: 'VARCHAR2(20)',  tgt: 'provide',         tgt_type: 'nvarchar(20)',  drift: null },
  { src: 'LIFECYCLE_STAGE', src_type: 'VARCHAR2(20)',  tgt: '— (not mapped)',  tgt_type: '—',             drift: 'new' },
];

export const SOURCE_OBJECTS: SourceObject[] = [
  { name: 'IFSAPP.INVENTORY_PART_TAB',      rowcount: 1284302,  last_seen: '2 min ago',  jobs: 2 },
  { name: 'IFSAPP.CUSTOMER_INFO',           rowcount: 412048,   last_seen: '34 sec ago', jobs: 2 },
  { name: 'IFSAPP.PURCHASE_ORDER_LINE_TAB', rowcount: 9412044,  last_seen: '14 min ago', jobs: 2 },
  { name: 'IAL.CUSTOMER_ORDER_HIST',        rowcount: 14820322, last_seen: '6 min ago',  jobs: 2 },
  { name: 'IFSAPP.CUSTOMER_ORDER_LINE_TAB', rowcount: 3128404,  last_seen: '22 min ago', jobs: 1 },
  { name: 'IFSAPP.SUPPLIER_INFO',           rowcount: 48201,    last_seen: '5 hours ago', jobs: 1 },
];
