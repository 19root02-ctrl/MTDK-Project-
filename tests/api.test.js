const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

/**
 * Creates a fake MySQL pool that handles all SQL patterns used by:
 * - initializeDatabase() (CREATE DATABASE, CREATE TABLE, ALTER TABLE, INSERT, SELECT, INFORMATION_SCHEMA)
 * - The API endpoints (INSERT, UPDATE, DELETE, SELECT)
 */
function createFakePool(customHandlers = {}) {
  const state = {};

  const pool = {
    query: async (sql, params) => {
      // ── Database initialization queries ──
      if (/CREATE\s+DATABASE/i.test(sql)) {
        return [{}, null];
      }
      if (/^\s*USE\s/i.test(sql)) {
        return [{}, null];
      }
      if (/CREATE\s+TABLE/i.test(sql)) {
        return [{}, null];
      }
      if (/ALTER\s+TABLE/i.test(sql)) {
        return [{}, null];
      }
      if (/INSERT\s+INTO\s+admin_users/i.test(sql)) {
        return [{}, null];
      }
      if (/INSERT\s+INTO\s+.+study_resources/i.test(sql)) {
        return [{}, null];
      }
      if (/SELECT\s+COLUMN_NAME\s+FROM\s+INFORMATION_SCHEMA/i.test(sql)) {
        return [[{ COLUMN_NAME: 'whatsapp' }], null];
      }

      // ── Student duplicate check ──
      if (/SELECT\s+reg_no\s+FROM\s+students\s+WHERE\s+whatsapp/i.test(sql)) {
        return (customHandlers.duplicateWhatsapp)
          ? [[{ reg_no: 'IMTSE-10001' }], null]
          : [[], null];
      }

      // ── SELECT single student ──
      if (/SELECT\s+\*\s+FROM\s+students\s+WHERE\s+(reg_no|whatsapp)/i.test(sql)) {
        if (customHandlers.selectStudent) {
          return [[customHandlers.selectStudent], null];
        }
        return [[{
          reg_no: 'IMTSE-10001',
          full_name: 'TEST USER',
          student_class: 'VII',
          medium: 'English',
          school_name: 'TEST SCHOOL',
          dob: '2014-08-15',
          parent_name: 'TEST PARENT',
          whatsapp: '1234567890',
          email: 'test@example.com',
          address: 'TEST ADDRESS',
          amount: '\u20b9100.00',
          pay_mode: 'UPI',
          status: 'Approved',
          reg_date: '2026-07-19'
        }], null];
      }

      // ── SELECT all students ──
      if (/SELECT\s+\*\s+FROM\s+students/i.test(sql)) {
        return [[{
          reg_no: 'IMTSE-10001',
          full_name: 'TEST USER',
          student_class: 'VII',
          medium: 'English',
          school_name: 'TEST SCHOOL',
          dob: '2014-08-15',
          parent_name: 'TEST PARENT',
          whatsapp: '1234567890',
          email: 'test@example.com',
          address: 'TEST ADDRESS',
          amount: '\u20b9100.00',
          pay_mode: 'UPI',
          status: 'Approved',
          reg_date: '2026-07-19'
        }], null];
      }

      // ── INSERT student ──
      if (/INSERT\s+INTO\s+students/i.test(sql)) {
        return [{ insertId: 1 }, null];
      }

      // ── UPDATE student ──
      if (/UPDATE\s+students\s+SET/i.test(sql)) {
        state.lastUpdate = { sql, params };
        return [{ affectedRows: 1 }, null];
      }

      // ── DELETE student ──
      if (/DELETE\s+FROM\s+students/i.test(sql)) {
        return [{ affectedRows: 1 }, null];
      }

      // ── SELECT 1 (health check) ──
      if (/SELECT\s+1/i.test(sql)) {
        return [[{ '1': 1 }], null];
      }

      // ── Fallback ──
      return [[], null];
    }
  };

  pool._state = state;
  return pool;
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

test('POST /api/students saves a student payload', async () => {
  const fakePool = createFakePool();
  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'TEST USER',
        class: 'VII',
        medium: 'English',
        schoolName: 'TEST SCHOOL',
        dob: '2014-08-15',
        parentName: 'TEST PARENT',
        whatsapp: '1234567890',
        address: 'TEST ADDRESS',
        amount: '\u20b9100.00',
        payMode: 'UPI',
        regNo: 'IMTSE-10001',
        status: 'Approved',
        regDate: '2026-07-19'
      })
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.regNo, 'IMTSE-10001');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('POST /api/students rejects duplicate whatsapp numbers', async () => {
  const fakePool = createFakePool({ duplicateWhatsapp: true });
  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'TEST USER',
        class: 'VII',
        medium: 'English',
        schoolName: 'TEST SCHOOL',
        dob: '2014-08-15',
        parentName: 'TEST PARENT',
        whatsapp: '1234567890',
        address: 'TEST ADDRESS',
        amount: '\u20b9100.00',
        payMode: 'UPI',
        regNo: 'IMTSE-10001',
        status: 'Approved',
        regDate: '2026-07-19'
      })
    });

    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.match(payload.error, /already registered/i);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('PUT /api/students/:studentId updates the student record in the database', async () => {
  const fakePool = createFakePool({
    selectStudent: {
      reg_no: 'IMTSE-10001',
      full_name: 'OLD NAME',
      student_class: 'VII',
      medium: 'English',
      school_name: 'OLD SCHOOL',
      dob: '2014-08-15',
      parent_name: 'OLD PARENT',
      whatsapp: '1234567890',
      address: 'OLD ADDRESS',
      amount: '\u20b9100.00',
      pay_mode: 'UPI',
      status: 'Approved',
      reg_date: '2026-07-19'
    }
  });

  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/students/IMTSE-10001`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'UPDATED USER',
        class: 'VIII',
        medium: 'Hindi',
        schoolName: 'NEW SCHOOL',
        dob: '2014-08-15',
        parentName: 'UPDATED PARENT',
        whatsapp: '1111111111',
        address: 'UPDATED ADDRESS',
        amount: '\u20b9200.00',
        payMode: 'Cash',
        regNo: 'IMTSE-10002',
        status: 'Pending',
        regDate: '2026-07-20'
      })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.regNo, 'IMTSE-10002');
    assert.equal(fakePool._state.lastUpdate.params.at(-1), 'IMTSE-10001');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('POST /api/students/:studentId/approve sends an approval email', async () => {
  const fakePool = createFakePool({
    selectStudent: {
      reg_no: 'IMTSE-10001',
      full_name: 'TEST USER',
      student_class: 'VII',
      medium: 'English',
      school_name: 'TEST SCHOOL',
      dob: '2014-08-15',
      parent_name: 'TEST PARENT',
      whatsapp: '1234567890',
      email: 'student@example.com',
      address: 'TEST ADDRESS',
      amount: '₹100.00',
      pay_mode: 'UPI',
      status: 'Pending Verification',
      reg_date: '2026-07-19'
    }
  });

  const sendMailCalls = [];
  const fakeTransporter = {
    verify: async () => ({ ok: true }),
    sendMail: async (mailOptions) => {
      sendMailCalls.push(mailOptions);
      return { messageId: 'test-message-id' };
    }
  };

  const app = createServer({ pool: fakePool, emailTransporter: fakeTransporter });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/students/IMTSE-10001/approve`, { method: 'POST' });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.emailSent, true);
    assert.equal(sendMailCalls.length, 1);
    assert.equal(sendMailCalls[0].to, 'student@example.com');
    assert.ok(sendMailCalls[0].attachments && sendMailCalls[0].attachments[0].content instanceof Buffer);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('DELETE /api/students/:studentId removes the student from the database', async () => {
  const fakePool = createFakePool();
  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/students/IMTSE-10001`, {
      method: 'DELETE'
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.regNo, 'IMTSE-10001');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

