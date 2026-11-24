import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { defaultCategories } from '../services/categories.js';

export const requiredColumns = {
  users: ['id','email','phone','password_hash','display_name','status','email_verified_at','phone_verified_at','onboarding_completed_at','password_changed_at','last_login_at','auth_version','created_at','updated_at'],
  auth_identities: ['id','user_id','provider','provider_user_id','created_at','updated_at'],
  auth_sessions: ['id','user_id','token_hash','auth_version','expires_at','revoked_at','last_used_at','created_at'],
  password_reset_tokens: ['id','user_id','token_hash','auth_version_at_issue','expires_at','used_at','revoked_at','created_at'],
  user_profiles: ['user_id','full_name','birth_date','hometown','monthly_income','usage_purpose','usage_purpose_note','created_at','updated_at'],
  user_contact_verifications: ['id','user_id','channel','destination','request_key','token_hash','auth_version_at_issue','attempts','max_attempts','expires_at','used_at','revoked_at','created_at'],
  finance_wallets: ['id','user_id','name','kind','opening_amount','credit_limit','payment_due','note','archived_at'],
  finance_wallet_movements: ['id','user_id','wallet_id','related_wallet_id','operation_key','kind','delta','movement_date','created_at','note'],
  finance_categories: ['id','user_id','kind','name','icon','color','hidden_at','default_key'],
  user_finance_settings: ['user_id','number_style','cycle_start_day'],
  finance_transactions: ['id','user_id','kind','amount','wallet_id','category_id','transaction_date','note','revision','deleted_at'],
  finance_transaction_history: ['id','user_id','transaction_id','action','before_state','after_state','changed_at'],
  finance_goals: ['id','user_id','name','target_amount','saved_amount','due_date','note','deleted_at'],
  finance_budgets: ['id','user_id','category_id','kind','period','base_amount','carry_amount','threshold','auto_renew'],
};
export const requiredProcedures = {
  la_auth_register: 3, la_auth_get_login_user: 1, la_auth_resolve_login_identifier: 4,
  la_auth_check_login_identifier: 2, la_auth_get_login_user_by_identifier: 2,
  la_auth_create_session: 4, la_auth_issue_password_reset: 3, la_auth_reset_password: 2,
  la_onboarding_get_state: 1, la_onboarding_save_profile: 7, la_onboarding_issue_verification: 6,
  la_onboarding_verify_contact: 3, la_onboarding_complete: 1,
};
export function splitSql(source) {
  let delimiter = ';', buffer = '';
  const statements = [];
  for (const line of source.replace(/\r/g, '').split('\n')) {
    if (/^\s*--/.test(line) || !line.trim()) continue;
    const directive = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (directive) { delimiter = directive[1]; continue; }
    buffer += line + '\n';
    if (buffer.trimEnd().endsWith(delimiter)) {
      statements.push(buffer.trimEnd().slice(0, -delimiter.length).trim()); buffer = '';
    }
  }
  if (buffer.trim()) throw new Error('SQL chưa kết thúc đúng delimiter.');
  return statements;
}
export async function inspectSchema(connection, database, { allowMissing = false } = {}) {
  const [columns] = await connection.execute('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?', [database]);
  const problems = [];
  for (const [table, names] of Object.entries(requiredColumns)) {
    const existing = columns.filter(row => row.TABLE_NAME === table);
    if (!existing.length && allowMissing) continue;
    for (const name of names) if (!existing.some(row => row.COLUMN_NAME === name)) {
      // These are the only missing columns the bundled upgrade explicitly adds.
      if (allowMissing && table === 'users' && ['phone_verified_at','onboarding_completed_at'].includes(name)) continue;
      if (allowMissing && table === 'finance_categories' && ['icon','color','hidden_at','default_key'].includes(name)) continue;
      if (allowMissing && table === 'finance_goals' && ['due_date','note','deleted_at'].includes(name)) continue;
      if (allowMissing && table === 'finance_wallets' && ['kind','opening_amount','credit_limit','payment_due','note','archived_at'].includes(name)) continue;
      problems.push(`${table}.${name} thiếu`);
    }
    for (const column of existing) {
      if (['id', 'user_id'].includes(column.COLUMN_NAME) && !/^bigint(?:\(\d+\))? unsigned$/i.test(column.COLUMN_TYPE)) problems.push(`${table}.${column.COLUMN_NAME} phải là BIGINT UNSIGNED`);
      if (table === 'users' && ['phone', 'password_hash'].includes(column.COLUMN_NAME) && column.IS_NULLABLE !== 'YES') problems.push(`${table}.${column.COLUMN_NAME} phải cho phép NULL`);
    }
  }
  const definitions = {
    users: { email: ['varchar(254)', 'NO', 'ascii_general_ci'], phone: ['varchar(20)', 'YES', 'ascii_bin'], password_hash: ['varchar(255)', 'YES', 'ascii_bin'], display_name: ['varchar(100)', 'YES'], status: ["enum('active','disabled')", 'NO'], auth_version: ['int unsigned', 'NO'] },
    auth_identities: { provider: ["enum('google','facebook')", 'NO'], provider_user_id: ['varchar(191)', 'NO', 'ascii_bin'] },
    auth_sessions: { token_hash: ['char(64)', 'NO', 'ascii_bin'], auth_version: ['int unsigned', 'NO'] },
    password_reset_tokens: { token_hash: ['char(64)', 'NO', 'ascii_bin'], auth_version_at_issue: ['int unsigned', 'NO'] },
    user_profiles: { full_name: ['varchar(100)','NO'], birth_date: ['date','NO'], hometown: ['varchar(150)','NO'], monthly_income: ['decimal(15,2)','NO'], usage_purpose: ["enum('track_expenses','save_money','control_budget','repay_debt','other')",'NO'], usage_purpose_note: ['varchar(255)','YES'] },
    user_contact_verifications: { channel: ["enum('email','phone')",'NO'], destination: ['varchar(254)','NO','ascii_bin'], request_key: ['char(64)','NO','ascii_bin'], token_hash: ['char(64)','NO','ascii_bin'], auth_version_at_issue: ['int unsigned','NO'], attempts: ['tinyint unsigned','NO'], max_attempts: ['tinyint unsigned','NO'] },
    finance_wallets: { kind: ["enum('cash','bank','ewallet','credit')",'NO'], opening_amount: ['decimal(18,0)','NO'], credit_limit: ['decimal(18,0)','YES'], payment_due: ['date','YES'], note: ['varchar(500)','NO'] },
    finance_wallet_movements: { delta: ['decimal(30,0)','NO'], movement_date: ['date','NO'], operation_key: ['char(36)','NO','ascii_bin'] },
    finance_categories: { icon: ['varchar(24)','YES','ascii_bin'], color: ['char(7)','YES','ascii_bin'], default_key: ['varchar(24)','YES','ascii_bin'] },
    user_finance_settings: { number_style: ["enum('dots','commas')",'NO'], cycle_start_day: ['tinyint unsigned','NO'] },
    finance_transactions: { amount: ['decimal(18,0)','NO'], transaction_date: ['date','NO'] },
    finance_transaction_history: { changed_at: ['datetime(6)','NO'] },
    finance_goals: { target_amount: ['decimal(18,0)','NO'], saved_amount: ['decimal(18,0)','NO'], due_date: ['date','YES'], note: ['varchar(500)','YES'] },
    finance_budgets: { period: ['date','NO'], base_amount: ['decimal(18,0)','NO'], carry_amount: ['decimal(24,0)','NO'] },
  };
  for (const [table, names] of Object.entries(requiredColumns)) {
    if (allowMissing && !columns.some(row => row.TABLE_NAME === table)) continue;
    for (const name of names) {
      const column = columns.find(row => row.TABLE_NAME === table && row.COLUMN_NAME === name);
      if (!column) continue;
      const expected = definitions[table][name] || (name.endsWith('_at') ? ['datetime(6)', ['created_at', 'updated_at', 'expires_at'].includes(name) ? 'NO' : 'YES'] : null);
      if (expected) {
        const type = column.COLUMN_TYPE.toLowerCase().replace(/\b(int|bigint|tinyint)\(\d+\)/g, '$1');
        if (type !== expected[0] || column.IS_NULLABLE !== expected[1] || (expected[2] && column.COLLATION_NAME !== expected[2])) problems.push(`${table}.${name} không đúng kiểu/null/collation trong schema.sql`);
      }
    }
  }
  const [indexes] = await connection.execute('SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?', [database]);
  const constraints = { users: { PRIMARY: ['id'], uq_users_email: ['email'], uq_users_phone: ['phone'] }, auth_sessions: { PRIMARY: ['id'], uq_session_token_hash: ['token_hash'] }, password_reset_tokens: { PRIMARY: ['id'], uq_reset_token_hash: ['token_hash'] }, auth_identities: { PRIMARY: ['id'], uq_identity_provider_subject: ['provider','provider_user_id'], uq_identity_user_provider: ['user_id','provider'] } };
  constraints.user_profiles = { PRIMARY: ['user_id'] };
  constraints.user_contact_verifications = { PRIMARY: ['id'], uq_contact_request_key: ['request_key'] };
  constraints.finance_budgets = { PRIMARY: ['id'], uq_fin_budget_period: ['user_id','category_id','period'] };
  constraints.finance_wallet_movements = { PRIMARY: ['id'], uq_fin_wallet_operation: ['user_id','operation_key','wallet_id'] };
  constraints.user_finance_settings = { PRIMARY: ['user_id'] };
  if (!allowMissing) constraints.finance_categories = { uq_fin_category_default: ['user_id','default_key'] };
  for (const [table, definitions] of Object.entries(constraints)) {
    if (allowMissing && !columns.some(row => row.TABLE_NAME === table)) continue;
    for (const [key, names] of Object.entries(definitions)) {
      const parts = indexes.filter(row => row.TABLE_NAME === table && row.INDEX_NAME === key).sort((a,b) => a.SEQ_IN_INDEX-b.SEQ_IN_INDEX);
      if (parts.length !== names.length || parts.some((part, index) => Number(part.NON_UNIQUE) !== 0 || part.COLUMN_NAME !== names[index])) problems.push(`${table} cần UNIQUE ${key}`);
    }
  }
  const [tables] = await connection.execute('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [database]);
  for (const row of tables) if (requiredColumns[row.TABLE_NAME] && row.ENGINE !== 'InnoDB') problems.push(`${row.TABLE_NAME} phải dùng InnoDB`);
  const [foreignKeys] = await connection.execute('SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL', [database]);
  for (const table of ['auth_identities','auth_sessions','password_reset_tokens','user_profiles','user_contact_verifications']) {
    if (allowMissing && !columns.some(row => row.TABLE_NAME === table)) continue;
    if (!foreignKeys.some(row => row.TABLE_NAME === table && row.COLUMN_NAME === 'user_id' && row.REFERENCED_TABLE_NAME === 'users' && row.REFERENCED_COLUMN_NAME === 'id')) problems.push(`${table}.user_id thiếu khóa ngoại tới users.id`);
  }
  return problems;
}
export async function checkProcedures(connection, database) {
  const [rows] = await connection.execute('SELECT SPECIFIC_NAME, COUNT(*) AS param_count FROM information_schema.PARAMETERS WHERE SPECIFIC_SCHEMA = ? GROUP BY SPECIFIC_NAME', [database]);
  const problems = Object.entries(requiredProcedures).filter(([name, count]) => !rows.some(row => row.SPECIFIC_NAME === name && Number(row.param_count) === count)).map(([name]) => `Thiếu/sai tham số procedure ${name}`);
  const [triggers] = await connection.execute('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?', [database]);
  if (!triggers.some(row => row.TRIGGER_NAME === 'la_users_contact_verification_guard')) problems.push('Thiếu trigger la_users_contact_verification_guard');
  return problems;
}
export async function initializeSchema(settings) {
  if (!settings.user) throw new Error('Điền DB_USER trong .env trước khi chạy migration.');
  const { database, ...server } = settings;
  if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error('Invalid database name');
  const connection = await mysql.createConnection({ ...server, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
  try {
    // Refuse to modify incompatible existing tables. Never silently coerce real data.
    const problems = await inspectSchema(connection, database, { allowMissing: true });
    if (problems.length) throw new Error('Cấu trúc hiện có không tương thích; cần migration riêng sau khi sao lưu:\n' + problems.join('\n'));
    let source = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    if (database !== 'qlthuchi') source = source.replaceAll('qlthuchi', database);
    for (const statement of splitSql(source)) await connection.query(statement);
    const [iconColumns] = await connection.execute(
      "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='finance_categories' AND COLUMN_NAME='icon'",[database]);
    if (!iconColumns.length) await connection.query('ALTER TABLE finance_categories ADD COLUMN icon VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL');
    await markLegacyDefaultCategories(connection);
    const after = [...await inspectSchema(connection, database), ...await checkProcedures(connection, database)];
    if (after.length) throw new Error(after.join('\n'));
  } finally { await connection.end(); }
}

export async function markLegacyDefaultCategories(connection) {
  for (const {key,kind,name,icon} of defaultCategories) {
    await connection.execute(`UPDATE finance_categories c LEFT JOIN finance_categories d
      ON d.user_id=c.user_id AND d.default_key=?
      SET c.default_key=? WHERE d.id IS NULL AND c.default_key IS NULL AND c.kind=?
        AND BINARY c.name=BINARY ? AND (c.icon=? OR c.icon IS NULL)`,[key,key,kind,name,icon]);
  }
}
