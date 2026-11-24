import mysql from 'mysql2/promise';

export function openDatabase(settings) {
  if (!settings.user) throw new Error('Chưa cấu hình DB_USER trong .env.');
  const pool = mysql.createPool({
    ...settings, waitForConnections: true, connectionLimit: 10, queueLimit: 100,
    connectTimeout: 10000, charset: 'utf8mb4', timezone: 'Z',
    supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false,
  });
  return {
    async execute(sql, params = []) {
      const connection = await pool.getConnection();
      try {
        // Driver timezone only converts dates. Set the SQL session on every checkout.
        await connection.query("SET time_zone = '+00:00'");
        const [rows] = await connection.execute(sql, params);
        return rows;
      } finally { connection.release(); }
    },
    async call(name, params = []) {
      if (!/^la_(auth|onboarding)_[a-z_]+$/.test(name)) throw new Error('Invalid procedure name');
      const sets = await this.execute(`CALL ${name}(${params.map(() => '?').join(', ')})`, params);
      return Array.isArray(sets[0]) ? sets[0] : [];
    },
    async transaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.query("SET time_zone = '+00:00'");
        await connection.beginTransaction();
        const execute = async (sql, params = []) => (await connection.execute(sql, params))[0];
        const result = await work({ execute });
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally { connection.release(); }
    },
    close: () => pool.end(),
  };
}
