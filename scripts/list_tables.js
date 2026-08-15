const { Pool } = require('pg');
const dbConfig = require('../db.config');

(async function() {
  const pool = new Pool(dbConfig);
  try {
    await pool.query('SELECT 1');
    const tablesRes = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
    const tables = tablesRes.rows.map(r => r.table_name);
    console.log('TABLES:', JSON.stringify(tables));
    for (const t of tables) {
      const cntRes = await pool.query(`SELECT COUNT(*)::bigint AS cnt FROM "${t}"`);
      console.log(`COUNT:${t}:${cntRes.rows[0].cnt}`);
    }
    await pool.end();
  } catch (e) {
    console.error('DBERR:', e && e.message ? e.message : e);
    try { await pool.end(); } catch {};
    process.exit(1);
  }
})();
