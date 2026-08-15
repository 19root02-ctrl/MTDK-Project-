require('dotenv').config();
const cfg = require('../db.config');
const { Pool } = require('pg');
(async function(){
  const p = new Pool(cfg);
  try {
    await p.query('SELECT 1');
    const r = await p.query('SELECT count(*)::bigint AS cnt FROM students WHERE whatsapp=$1', ['9000000011']);
    console.log('DB_COUNT:', r.rows);
  } catch (e) {
    console.error('DB_CHECK_ERR:', e && e.message ? e.message : e);
  } finally {
    await p.end();
  }
})();
