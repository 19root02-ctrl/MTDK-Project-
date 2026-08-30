const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

/**
 * Creates a fake PostgreSQL-like pool that handles the SQL patterns used by the app.
 * This keeps the project test coverage aligned with the PostgreSQL migration while
 * preserving the same route contracts and validation logic.
 */
function createFakePool(customHandlers = {}) {
  const state = {};

  const pool = {
    query: async (sql, params) => {
      const normalizedSql = String(sql || '').trim();

      if (/SELECT\s+1/i.test(normalizedSql)) {
        return { rows: [{ '?column?': 1 }] };
      }

      if (/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(normalizedSql) || /ALTER\s+TABLE\s+students\s+ADD\s+COLUMN/i.test(normalizedSql)) {
        return { rows: [] };
      }

      if (/INSERT\s+INTO\s+admin_users/i.test(normalizedSql)) {
        return { rows: [] };
      }

      if (/INSERT\s+INTO\s+study_resources/i.test(normalizedSql)) {
        return { rows: [{ id: 1 }] };
      }

      if (/SELECT\s+reg_no\s+FROM\s+students\s+WHERE\s+whatsapp\s*=\s*\$1/i.test(normalizedSql)) {
        return (customHandlers.duplicateWhatsapp)
          ? { rows: [{ reg_no: 'IMTSE-10001' }] }
          : { rows: [] };
      }

      if (/SELECT\s+\*\s+FROM\s+students\s+WHERE\s+reg_no\s*=\s*\$1\s+OR\s+whatsapp\s*=\s*\$2\s+LIMIT\s+1/i.test(normalizedSql)) {
        if (customHandlers.selectStudent) {
          return { rows: [customHandlers.selectStudent] };
        }
        return { rows: [{
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
        }] };
      }

      if (/SELECT\s+\*\s+FROM\s+students\s+ORDER\s+BY\s+created_at\s+DESC/i.test(normalizedSql)) {
        if (customHandlers.listStudents) {
          return { rows: customHandlers.listStudents };
        }
        return { rows: [{
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
        }] };
      }

      if (/INSERT\s+INTO\s+students/i.test(normalizedSql)) {
        return { rows: [{ insertId: 1 }] };
      }

      if (/UPDATE\s+students\s+SET\s+/i.test(normalizedSql)) {
        state.lastUpdate = { sql, params };
        return { rows: [{ affectedRows: 1 }] };
      }

      if (/DELETE\s+FROM\s+students/i.test(normalizedSql)) {
        return { rows: [{ affectedRows: 1 }] };
      }

      if (/INSERT\s+INTO\s+study_resources/i.test(normalizedSql)) {
        return { rows: [{ id: 1 }] };
      }

      if (/UPDATE\s+study_resources\s+SET/i.test(normalizedSql)) {
        return { rows: [{ affectedRows: 1 }] };
      }

      if (/DELETE\s+FROM\s+study_resources/i.test(normalizedSql)) {
        return { rows: [{ affectedRows: 1 }] };
      }

      if (/SELECT\s+\*\s+FROM\s+study_resources/i.test(normalizedSql)) {
        return { rows: [] };
      }

      return { rows: [] };
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
        paymentScreenshotData: 'data:image/png;base64,abc123',
        paymentScreenshotName: 'upi.png',
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
        paymentScreenshotData: 'data:image/png;base64,abc123',
        paymentScreenshotName: 'upi.png',
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
test('POST /api/results/upload validates and calculates results for valid marks', async () => {
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
      email: 'test@example.com',
      address: 'TEST ADDRESS',
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
    const response = await fetch(`http://127.0.0.1:${port}/api/results/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: [{
          registrationNo: 'IMTSE-10001',
          schoolName: 'TEST SCHOOL',
          mathematics: 80,
          english: 75,
          science: 90
        }]
      })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.validStudents, 1);
    assert.equal(payload.summary.total, 245);
    assert.equal(payload.results[0].resultStatus, 'PASS');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('POST /api/results/upload rejects a mismatched school name and keeps multi-school support', async () => {
  const fakePool = createFakePool({
    listStudents: [{
      reg_no: 'IMTSE-10001',
      full_name: 'TEST USER',
      student_class: 'VII',
      medium: 'English',
      school_name: 'ABC School',
      dob: '2014-08-15',
      parent_name: 'TEST PARENT',
      whatsapp: '1234567890',
      email: 'test@example.com',
      address: 'TEST ADDRESS',
      amount: '\u20b9100.00',
      pay_mode: 'UPI',
      status: 'Approved',
      reg_date: '2026-07-19'
    }, {
      reg_no: 'IMTSE-10002',
      full_name: 'ANOTHER USER',
      student_class: 'VI',
      medium: 'Marathi',
      school_name: 'XYZ School',
      dob: '2013-09-14',
      parent_name: 'OTHER PARENT',
      whatsapp: '9876543210',
      email: 'other@example.com',
      address: 'OTHER ADDRESS',
      amount: '\u20b9100.00',
      pay_mode: 'Cash',
      status: 'Approved',
      reg_date: '2026-07-20'
    }]
  });

  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/results/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: [{
          registrationNo: 'IMTSE-10001',
          schoolName: 'XYZ School',
          mathematics: 80,
          english: 75,
          science: 90
        }]
      })
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.errors[0].message, /School Name does not match the registered student/);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GET /api/students/export and /api/results/template include the school name for multi-school data', async () => {
  const fakePool = createFakePool({
    listStudents: [{
      reg_no: 'IMTSE-10001',
      full_name: 'RAHUL PATIL',
      student_class: 'V',
      medium: 'English',
      school_name: 'ABC School',
      dob: '2014-08-15',
      parent_name: 'RAMESH PATIL',
      whatsapp: '1234567890',
      email: 'rahul@example.com',
      address: 'Address 1',
      amount: '₹500.00',
      pay_mode: 'Cash',
      status: 'Approved',
      reg_date: '2026-07-19'
    }, {
      reg_no: 'IMTSE-10002',
      full_name: 'PRIYA SHAH',
      student_class: 'VI',
      medium: 'English',
      school_name: 'XYZ School',
      dob: '2013-09-14',
      parent_name: 'KIRAN SHAH',
      whatsapp: '9876543210',
      email: 'priya@example.com',
      address: 'Address 2',
      amount: '₹500.00',
      pay_mode: 'UPI',
      status: 'Approved',
      reg_date: '2026-07-20'
    }]
  });

  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const studentsRes = await fetch(`http://127.0.0.1:${port}/api/students/export`);
    assert.equal(studentsRes.status, 200);
    const studentsCsv = await studentsRes.text();
    assert.match(studentsCsv, /School Name/i);
    assert.match(studentsCsv, /ABC School/i);

    const templateRes = await fetch(`http://127.0.0.1:${port}/api/results/template`);
    assert.equal(templateRes.status, 200);
    const templateCsv = await templateRes.text();
    assert.match(templateCsv, /School Name/i);
    assert.match(templateCsv, /ABC School/i);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GET /api/results/me only returns the authenticated student result', async () => {
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
      email: 'test@example.com',
      address: 'TEST ADDRESS',
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
    const response = await fetch(`http://127.0.0.1:${port}/api/results/me?regNo=IMTSE-10001&dob=2014-08-15`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.student.regNo, 'IMTSE-10001');

    const forbidden = await fetch(`http://127.0.0.1:${port}/api/results/me?regNo=IMTSE-99999&dob=2014-08-15`);
    assert.equal(forbidden.status, 403);
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
    const response = await fetch('http://127.0.0.1:' + port + '/api/students/IMTSE-10001/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    assert.equal(response.status, 200);
    const sendCallsCount = sendMailCalls.length;
    assert(sendCallsCount > 0, 'Email should have been sent');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

// ═══════════════════════════════════════════════════════════════════
// Hall Ticket Availability Tests
// ═══════════════════════════════════════════════════════════════════

test('GET /api/hall-ticket/status returns locked status BEFORE unlock date', async () => {
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const futureDay = String(futureDate.getDate()).padStart(2, '0');
  const futureMonth = String(futureDate.getMonth() + 1).padStart(2, '0');
  const futureYear = futureDate.getFullYear();
  process.env.HALL_TICKET_UNLOCK_DATE = `${futureDay}-${futureMonth}-${futureYear} 00:00 Asia/Kolkata`;

  const fakePool = createFakePool();
  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/hall-ticket/status`);

    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.equal(payload.available, false);
    assert.match(payload.message, /Hall Ticket will be available/i);
  } finally {
    delete process.env.HALL_TICKET_UNLOCK_DATE;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GET /api/hall-ticket/status returns available status ON/AFTER unlock date', async () => {
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pastDay = String(pastDate.getDate()).padStart(2, '0');
  const pastMonth = String(pastDate.getMonth() + 1).padStart(2, '0');
  const pastYear = pastDate.getFullYear();
  process.env.HALL_TICKET_UNLOCK_DATE = `${pastDay}-${pastMonth}-${pastYear} 00:00 Asia/Kolkata`;

  const fakePool = createFakePool();
  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/hall-ticket/status`);

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.available, true);
    assert.match(payload.message, /Hall Ticket is available/i);
  } finally {
    delete process.env.HALL_TICKET_UNLOCK_DATE;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('Hall Ticket availability uses Asia/Kolkata (IST) timezone', async () => {
  const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const futureDay = String(futureDate.getDate()).padStart(2, '0');
  const futureMonth = String(futureDate.getMonth() + 1).padStart(2, '0');
  const futureYear = futureDate.getFullYear();
  process.env.HALL_TICKET_UNLOCK_DATE = `${futureDay}-${futureMonth}-${futureYear} 00:00 Asia/Kolkata`;

  const fakePool = createFakePool();
  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/hall-ticket/status`);

    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.available, false);
  } finally {
    delete process.env.HALL_TICKET_UNLOCK_DATE;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('Hall Ticket API returns correct unlock date in response', async () => {
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const futureDay = String(futureDate.getDate()).padStart(2, '0');
  const futureMonth = String(futureDate.getMonth() + 1).padStart(2, '0');
  const futureYear = futureDate.getFullYear();
  process.env.HALL_TICKET_UNLOCK_DATE = `${futureDay}-${futureMonth}-${futureYear} 00:00 Asia/Kolkata`;

  const fakePool = createFakePool();
  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/hall-ticket/status`);
    const payload = await response.json();

    assert(payload.unlockDate);
    assert.match(payload.unlockDate, new RegExp(`${futureDay}-${futureMonth}-${futureYear}`));
  } finally {
    delete process.env.HALL_TICKET_UNLOCK_DATE;
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

