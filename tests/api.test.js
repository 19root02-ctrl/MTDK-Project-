const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('../server');
const { normalizeResultHeader } = require('../result-subjects');

const adminHeaders = {
  Authorization: `Basic ${Buffer.from('MTDK:MTDK@123').toString('base64')}`
};

test.beforeEach(() => {
  global.__release_controls = { hallTicketReleased: false, resultReleased: false };
});

test('Result headers normalize to the exact upload API contract', () => {
  assert.deepEqual([
    normalizeResultHeader('Marathi'),
    normalizeResultHeader('English'),
    normalizeResultHeader('Maths'),
    normalizeResultHeader('EVS / Science'),
    normalizeResultHeader('Social Science'),
    normalizeResultHeader('Logical Reasoning')
  ], ['marathi', 'english', 'maths', 'evsScience', 'socialScience', 'logicalReasoning']);
});

test('Global release controls require admin access and release Hall Tickets/results together', async () => {
  const previousResults = global.__student_results;
  global.__student_results = [
    { reg_no: 'IMTSE-REL3', student_name: 'PRIMARY', className: 'III', marathi: 40, english: 40, maths: 40, evs: 40, logicalReasoning: 40, total_marks: 200, status: 'DRAFT' },
    { reg_no: 'IMTSE-REL7', student_name: 'SECONDARY', className: 'VII', marathi: 30, english: 30, maths: 30, evsScience: 30, socialScience: 30, logicalReasoning: 50, total_marks: 200, status: 'VERIFIED' }
  ];
  const fakePool = createFakePool({
    listStudents: [
      { reg_no: 'IMTSE-REL3', full_name: 'PRIMARY', student_class: 'III', dob: '2014-08-15', school_name: 'SCHOOL' },
      { reg_no: 'IMTSE-REL7', full_name: 'SECONDARY', student_class: 'VII', dob: '2014-08-16', school_name: 'SCHOOL' }
    ]
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const initial = await fetch(`${baseUrl}/api/admin/release-status`, { headers: adminHeaders });
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json(), { hallTicketReleased: false, resultReleased: false });

    const forbidden = await fetch(`${baseUrl}/api/admin/release/hall-ticket`, { method: 'POST' });
    assert.equal(forbidden.status, 401);

    const hallRelease = await fetch(`${baseUrl}/api/admin/release/hall-ticket`, { method: 'POST', headers: adminHeaders });
    assert.equal(hallRelease.status, 200);
    assert.equal((await hallRelease.json()).hallTicketReleased, true);

    const blockedResultRelease = await fetch(`${baseUrl}/api/admin/release/result`, { method: 'POST', headers: adminHeaders });
    assert.equal(blockedResultRelease.status, 409);

    global.__student_results[0].status = 'VERIFIED';
    const resultRelease = await fetch(`${baseUrl}/api/admin/release/result`, { method: 'POST', headers: adminHeaders });
    assert.equal(resultRelease.status, 200);
    const released = await resultRelease.json();
    assert.equal(released.resultReleased, true);
    assert.equal(global.__student_results.every(result => result.status === 'PUBLISHED'), true);

    const ownResult = await fetch(`${baseUrl}/api/results/me?regNo=IMTSE-REL3&dob=2014-08-15`);
    assert.equal((await ownResult.json()).result.regNo, 'IMTSE-REL3');
    const otherResult = await fetch(`${baseUrl}/api/results/me?regNo=IMTSE-REL7&dob=2014-08-15`);
    assert.equal(otherResult.status, 403);
  } finally {
    global.__student_results = previousResults;
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

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

function parseGeneratedCsv(csvText) {
  const lines = String(csvText).trim().split(/\r?\n/).map(line => line.split(',').map(value => value.replace(/^"|"$/g, '')));
  const headers = lines.shift();
  return lines.map(line => Object.fromEntries(headers.map((header, index) => [header, line[index] || ''])));
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
test('POST /api/results/upload calculates a senior 200-mark total', async () => {
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
          marathi: 30,
          english: 30,
          maths: 30,
          evsScience: 30,
          socialScience: 30,
          logicalReasoning: 50
        }]
      })
    });

    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const payload = JSON.parse(responseText);
    assert.equal(payload.validStudents, 1);
    assert.equal(payload.summary.total, 200);
    assert.equal(payload.results[0].totalMarks, 200);
    assert.equal(payload.results[0].percentage, undefined);
    assert.equal(payload.results[0].resultStatus, undefined);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('POST /api/results/upload calculates a junior 200-mark total', async () => {
  const fakePool = createFakePool({
    listStudents: [{
      reg_no: 'IMTSE-20001',
      full_name: 'JUNIOR USER',
      student_class: 'IV',
      medium: 'English',
      school_name: 'JUNIOR SCHOOL'
    }]
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/results/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: [{
        registrationNo: 'IMTSE-20001',
        schoolName: 'JUNIOR SCHOOL',
        marathi: 40,
        english: 40,
        maths: 40,
        evs: 40,
        logicalReasoning: 40,
        socialScience: 99
      }] })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.results[0].totalMarks, 200);
    assert.equal(payload.results[0].socialScience, undefined);
    assert.equal(payload.results[0].percentage, undefined);
    assert.equal(payload.results[0].resultStatus, undefined);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Group-specific uploads reject wrong classes and validate zero, blank, and maximum marks', async () => {
  const fakePool = createFakePool({
    listStudents: [
      { reg_no: 'IMTSE-GROUP3', full_name: 'PRIMARY TEST', student_class: 'III', school_name: 'GROUP SCHOOL' },
      { reg_no: 'IMTSE-GROUP7', full_name: 'SECONDARY TEST', student_class: 'VII', school_name: 'GROUP SCHOOL' }
    ]
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  const post = (path, result) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results: [result] })
  });

  try {
    const wrongPrimary = await post('/api/results/upload/primary', {
      registrationNo: 'IMTSE-GROUP7', marathi: 30, english: 30, maths: 30,
      evsScience: 30, socialScience: 30, logicalReasoning: 50
    });
    assert.equal(wrongPrimary.status, 400);
    assert.match((await wrongPrimary.json()).errors[0].message, /does not belong to Classes 1–4/);

    const wrongSecondary = await post('/api/results/upload/secondary', {
      registrationNo: 'IMTSE-GROUP3', marathi: 40, english: 40, maths: 40, evs: 40, logicalReasoning: 40
    });
    assert.equal(wrongSecondary.status, 400);
    assert.match((await wrongSecondary.json()).errors[0].message, /does not belong to Classes 5–10/);

    const primaryValid = await post('/api/results/upload/primary', {
      registrationNo: 'IMTSE-GROUP3', marathi: 0, english: 40, maths: 40, evs: 40, logicalReasoning: 40
    });
    assert.equal(primaryValid.status, 200);
    assert.equal((await primaryValid.json()).results[0].totalMarks, 160);

    const primaryTooHigh = await post('/api/results/upload/primary', {
      registrationNo: 'IMTSE-GROUP3', marathi: 41, english: 40, maths: 40, evs: 40, logicalReasoning: 40
    });
    assert.equal(primaryTooHigh.status, 400);
    assert.match((await primaryTooHigh.json()).errors[0].message, /Invalid marks for: Marathi/);

    const primaryBlank = await post('/api/results/upload/primary', {
      registrationNo: 'IMTSE-GROUP3', marathi: '', english: 40, maths: 40, evs: 40, logicalReasoning: 40
    });
    assert.equal(primaryBlank.status, 400);
    assert.match((await primaryBlank.json()).errors[0].message, /Missing marks for: Marathi/);

    const secondaryValid = await post('/api/results/upload/secondary', {
      registrationNo: 'IMTSE-GROUP7', marathi: 30, english: 30, maths: 30,
      evsScience: 30, socialScience: 30, logicalReasoning: 50
    });
    assert.equal(secondaryValid.status, 200);
    assert.equal((await secondaryValid.json()).results[0].totalMarks, 200);

    const secondaryTooHigh = await post('/api/results/upload/secondary', {
      registrationNo: 'IMTSE-GROUP7', marathi: 31, english: 30, maths: 30,
      evsScience: 30, socialScience: 30, logicalReasoning: 51
    });
    assert.equal(secondaryTooHigh.status, 400);
    assert.match((await secondaryTooHigh.json()).errors[0].message, /Invalid marks for: Marathi, Logical Reasoning/);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Primary and secondary results share storage and Publish All publishes both groups', async () => {
  const previousResults = global.__student_results;
  global.__student_results = [];
  const fakePool = createFakePool({
    listStudents: [
      { reg_no: 'IMTSE-PUBLISH3', full_name: 'PRIMARY PUBLISH', student_class: 'III', school_name: 'PUBLISH SCHOOL' },
      { reg_no: 'IMTSE-PUBLISH7', full_name: 'SECONDARY PUBLISH', student_class: 'VII', school_name: 'PUBLISH SCHOOL' }
    ]
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const upload = (group, result) => fetch(`${baseUrl}/api/results/upload/${group}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results: [result] })
    });
    assert.equal((await upload('primary', { registrationNo: 'IMTSE-PUBLISH3', marathi: 40, english: 40, maths: 40, evs: 40, logicalReasoning: 40 })).status, 200);
    assert.equal((await upload('secondary', { registrationNo: 'IMTSE-PUBLISH7', marathi: 30, english: 30, maths: 30, evsScience: 30, socialScience: 30, logicalReasoning: 50 })).status, 200);
    assert.equal(global.__student_results.filter(result => result.status === 'DRAFT').length, 2);

    for (const regNo of ['IMTSE-PUBLISH3', 'IMTSE-PUBLISH7']) {
      assert.equal((await fetch(`${baseUrl}/api/results/${regNo}/verify`, { method: 'POST' })).status, 200);
    }
    const publishResponse = await fetch(`${baseUrl}/api/results/publish-all`, { method: 'POST' });
    assert.equal(publishResponse.status, 200);
    assert.equal((await publishResponse.json()).published, 2);
    assert.equal(global.__student_results.every(result => result.status === 'PUBLISHED'), true);
  } finally {
    global.__student_results = previousResults;
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
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
      reg_no: 'IMTSE-10001', full_name: 'RAHUL PATIL', student_class: 'V', medium: 'English', school_name: 'ABC School', pay_mode: 'Cash'
    }, {
      reg_no: 'IMTSE-10002', full_name: 'PRIYA SHAH', student_class: 'IV', medium: 'English', school_name: 'XYZ School', pay_mode: 'UPI'
    }]
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const studentsRes = await fetch(`http://127.0.0.1:${port}/api/students/export`);
    assert.equal(studentsRes.status, 200);
    assert.match(await studentsRes.text(), /ABC School/i);

    const primaryTemplateRes = await fetch(`http://127.0.0.1:${port}/api/results/template/primary`);
    assert.equal(primaryTemplateRes.status, 200);
    const primaryTemplateCsv = await primaryTemplateRes.text();
    assert.match(primaryTemplateCsv, /Registration No,Student Name,School Name,Standard,Medium,Payment Mode,Marathi,English,Maths,EVS,Logical Reasoning,Total/);
    assert.match(primaryTemplateCsv, /IMTSE-10002/);
    assert.doesNotMatch(primaryTemplateCsv, /IMTSE-10001/);

    const secondaryTemplateRes = await fetch(`http://127.0.0.1:${port}/api/results/template/secondary`);
    assert.equal(secondaryTemplateRes.status, 200);
    const templateCsv = await secondaryTemplateRes.text();
    assert.match(templateCsv, /Registration No,Student Name,School Name,Standard,Medium,Payment Mode,Marathi,English,Maths,EVS \/ Science,Social Science,Logical Reasoning,Total/);
    assert.match(templateCsv, /IMTSE-10001/);
    assert.doesNotMatch(templateCsv, /IMTSE-10002/);
    assert.doesNotMatch(templateCsv, /Gender|Percentage|Result Status|PASS|FAIL/i);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
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

test('Result template and upload normalize Registration No headers and ignore blank rows', async () => {
  const fakePool = createFakePool({
    listStudents: [
      {
        reg_no: 'IMTSE-34990',
        full_name: 'SAIRAJ KULKARNI',
        student_class: 'VII',
        medium: 'English',
        school_name: 'ABC School',
        dob: '2014-08-15',
        parent_name: 'TEST PARENT',
        whatsapp: '1111111111',
        email: 'sairaj@example.com',
        address: 'TEST ADDRESS',
        amount: '\u20b9500.00',
        pay_mode: 'UPI',
        status: 'Approved',
        reg_date: '2026-07-19'
      },
      {
        reg_no: 'IMTSE-34991',
        full_name: 'RUPA SHARMA',
        student_class: 'VIII',
        medium: 'English',
        school_name: 'XYZ School',
        dob: '2013-09-14',
        parent_name: 'OTHER PARENT',
        whatsapp: '2222222222',
        email: 'rupa@example.com',
        address: 'OTHER ADDRESS',
        amount: '\u20b9500.00',
        pay_mode: 'Cash',
        status: 'Approved',
        reg_date: '2026-07-20'
      }
    ]
  });

  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const templateRes = await fetch(`http://127.0.0.1:${port}/api/results/template`);
    assert.equal(templateRes.status, 200);
    const templateCsv = await templateRes.text();
    assert.match(templateCsv, /Registration No/i);
    assert.match(templateCsv, /IMTSE-34990/i);
    assert.doesNotMatch(templateCsv, /Gender/i);

    const uploadRes = await fetch(`http://127.0.0.1:${port}/api/results/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: [
            { 'Reg. No': 'IMTSE-34990', Marathi: '30', English: '30', Maths: '30', EVS: '30', 'Social Science': '30', 'Logical Reasoning': '50', 'School Name': 'ABC School' },
            { 'Registration Number': 'IMTSE-34991', Marathi: '30', English: '30', Maths: '30', 'EVS / Science': '30', 'Social Science': '30', 'Logical Reasoning': '50', 'School Name': 'XYZ School' },
          { 'Registration No': '', 'Mathematics': '', 'English': '', 'Science': '', 'School Name': '' },
          { 'Reg No': 'IMTSE-99999', Marathi: '30', English: '30', Maths: '30', 'EVS / Science': '30', 'Social Science': '30', 'Logical Reasoning': '50', 'School Name': 'ABC School' }
        ]
      })
    });

    assert.equal(uploadRes.status, 400, 'an invalid registration should fail the upload, but blank trailing rows must not trigger the required-number error');
    const payload = await uploadRes.json();
    assert.equal(payload.validStudents, 0);
    assert.equal(payload.errors.length, 1);
    assert.match(payload.errors[0].message, /Registration number not found/i);
    assert.ok(!payload.errors.some(error => /Registration number is required/i.test(error.message || '')));
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('Generated result template uploads primary and secondary students with class-specific EVS mapping', async () => {
  const fakePool = createFakePool({
    listStudents: [
      { reg_no: 'IMTSE-30001', full_name: 'PRIMARY USER', student_class: 'III', school_name: 'PRIMARY SCHOOL' },
      { reg_no: 'IMTSE-70001', full_name: 'SECONDARY USER', student_class: 'VII', school_name: 'SECONDARY SCHOOL' }
    ]
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const templateResponse = await fetch(`${baseUrl}/api/results/template`);
    const templateCsv = await templateResponse.text();
    const templateRows = parseGeneratedCsv(templateCsv);
    const makeRow = (templateRow, values) => ({
      ...templateRow,
      ...Object.fromEntries(Object.entries(values).map(([header, value]) => [header, String(value)]))
    });

    const uploadResponse = await fetch(`${baseUrl}/api/results/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: [
        makeRow(templateRows[0], {
          'Registration No': 'IMTSE-30001', 'School Name': 'PRIMARY SCHOOL',
          Marathi: 35, English: 36, Maths: 38, 'EVS / Science': 37, 'Logical Reasoning': 39
        }),
        makeRow(templateRows[1], {
          'Registration No': 'IMTSE-70001', 'School Name': 'SECONDARY SCHOOL',
          Marathi: 25, English: 28, Maths: 27, 'EVS / Science': 26, 'Social Science': 24, 'Logical Reasoning': 45
        })
      ] })
    });

    assert.equal(uploadResponse.status, 200);
    const payload = await uploadResponse.json();
    assert.equal(payload.validStudents, 2);
    assert.equal(payload.results[0].totalMarks, 185);
    assert.equal(payload.results[0].evs, 37);
    assert.equal(payload.results[0].evsScience, undefined);
    assert.equal(payload.results[1].totalMarks, 175);
    assert.equal(payload.results[1].evsScience, 26);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Exact IMTSE-62440 CSV fixture preserves marks and reports over-limit values as invalid', async () => {
  const fakePool = createFakePool({
    listStudents: [{
      reg_no: 'IMTSE-62440',
      full_name: 'EXACT CSV USER',
      student_class: 'VII',
      school_name: ''
    }]
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const rows = parseGeneratedCsv(fs.readFileSync(path.join(__dirname, 'result_template_62440.csv'), 'utf8'));
    const row = rows[0];
    const canonicalRow = Object.fromEntries(Object.entries(row).map(([header, value]) => [normalizeResultHeader(header), value]));
    assert.deepEqual(canonicalRow, {
      registration_no: 'IMTSE-62440',
      student_name: '',
      school_name: '',
      standard: '',
      medium: '',
      payment_mode: '',
      marathi: '35',
      english: '35',
      maths: '36',
      evsScience: '29',
      socialScience: '28',
      logicalReasoning: '27',
      total: '192'
    });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/results/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: [canonicalRow] })
    });

    const responseText = await response.text();
    assert.equal(response.status, 400, responseText);
    const payload = JSON.parse(responseText);
    assert.match(payload.errors[0].message, /Invalid marks for: Marathi, English, Maths/);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('GET /api/results/me opens only published results to the matched student', async () => {
  const previousReleaseState = global.__release_controls;
  global.__release_controls = { hallTicketReleased: true, resultReleased: true };
  const previousResults = global.__student_results;
  global.__student_results = [
    {
      reg_no: 'IMTSE-10001',
      student_name: 'UNPUBLISHED USER',
      mathematics: 90,
      english: 80,
      science: 85,
      total_marks: 255,
      percentage: 85,
      result_status: 'PASS',
      status: 'DRAFT'
    },
    {
      reg_no: 'IMTSE-10002',
      student_name: 'PUBLISHED USER',
      mathematics: 95,
      english: 88,
      science: 90,
      total_marks: 273,
      percentage: 91,
      result_status: 'PASS',
      status: 'PUBLISHED'
    }
  ];

  const fakePool = createFakePool({
    listStudents: [
      {
        reg_no: 'IMTSE-10001',
        full_name: 'UNPUBLISHED USER',
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
      },
      {
        reg_no: 'IMTSE-10002',
        full_name: 'PUBLISHED USER',
        student_class: 'VII',
        medium: 'English',
        school_name: 'TEST SCHOOL',
        dob: '2014-08-14',
        parent_name: 'OTHER PARENT',
        whatsapp: '1111111111',
        email: 'other@example.com',
        address: 'OTHER ADDRESS',
        amount: '\u20b9120.00',
        pay_mode: 'Cash',
        status: 'Approved',
        reg_date: '2026-07-20'
      }
    ]
  });

  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const unpublished = await fetch(`http://127.0.0.1:${port}/api/results/me?regNo=IMTSE-10001&dob=2014-08-15`);
    assert.equal(unpublished.status, 200);
    const unpublishedPayload = await unpublished.json();
    assert.equal(unpublishedPayload.published, false);
    assert.equal(unpublishedPayload.result, null);

    const published = await fetch(`http://127.0.0.1:${port}/api/results/me?regNo=IMTSE-10002&dob=2014-08-14`);
    assert.equal(published.status, 200);
    const publishedPayload = await published.json();
    assert.equal(publishedPayload.published, true);
    assert.equal(publishedPayload.result.regNo, 'IMTSE-10002');
  } finally {
    global.__release_controls = previousReleaseState;
    global.__student_results = previousResults;
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
  const previousReleaseState = global.__release_controls;
  global.__release_controls = { hallTicketReleased: true, resultReleased: false };
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
    global.__release_controls = previousReleaseState;
    delete process.env.HALL_TICKET_UNLOCK_DATE;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GET /api/hall-ticket/status returns available status ON/AFTER unlock date', async () => {
  const previousReleaseState = global.__release_controls;
  global.__release_controls = { hallTicketReleased: true, resultReleased: false };
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
    global.__release_controls = previousReleaseState;
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

