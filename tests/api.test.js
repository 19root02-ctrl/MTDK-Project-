const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { createServer } = require('../server');
const { normalizeResultHeader } = require('../result-subjects');
const { EXAM_DATE } = require('../hallTicketConfig');

const adminHeaders = {
  Authorization: `Basic ${Buffer.from('MTDK:MTDK@123').toString('base64')}`
};

async function loginStudent(baseUrl, mobile, dob) {
  const response = await fetch(`${baseUrl}/api/student/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile, dob })
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie || '', /student_session=/);
  return { Cookie: cookie.split(';')[0] };
}

test.beforeEach(() => {
  global.__release_controls = { hallTicketReleased: false, resultReleased: false };
});

test('Result headers normalize to the exact upload API contract', () => {
  assert.deepEqual([
    normalizeResultHeader('Marathi'),
    normalizeResultHeader('English'),
    normalizeResultHeader('Maths & Logical Reasoning'),
    normalizeResultHeader('EVS / Science'),
    normalizeResultHeader('Social Science'),
    normalizeResultHeader('Maths and Logical Reasoning')
  ], ['marathi', 'english', 'mathsLogicalReasoning', 'evsScience', 'socialScience', 'mathsLogicalReasoning']);
});

test('Exam countdown configuration targets 14 February 2027 in India time', () => {
  assert.equal(EXAM_DATE, '2027-02-14T00:00:00+05:30');
});

test('Manual registration preview rejects rows missing DOB and invalid DOB', async () => {
  const app = createServer({ pool: createFakePool() });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/manual-registration/preview`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: [{
          'Sr. No.': 1,
          'Name of the Student': 'Test Student',
          'Std.': 'V',
          'Date of Birth': '',
          'Medium': 'English',
          'School & School Address': 'ABC School',
          'Mob. No.': '9876543210',
          'Email ID': 'student@example.com',
          'Payment Mode': 'UPI'
        }, {
          'Sr. No.': 2,
          'Name of the Student': 'Bad DOB Student',
          'Std.': 'V',
          'Date of Birth': '32-02-2017',
          'Medium': 'English',
          'School & School Address': 'ABC School',
          'Mob. No.': '9876543211',
          'Email ID': 'bad@example.com',
          'Payment Mode': 'Cash'
        }]
      })
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.validRecords, 0);
    assert.equal(Array.isArray(payload.errors), true);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Manual DOB validation maps the exact header and preserves Excel date cells', async () => {
  const app = createServer({ pool: createFakePool() });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/manual-registration/preview`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [
        {
          'Sr. No.': 1, 'Name of the Student': 'ISO DOB', 'Std.': 'V', 'Date of Birth': '2015-08-15',
          Medium: 'English', 'School & School Address': 'ABC School', 'Mob. No.': '9876543212',
          'Email ID': 'iso-dob@example.com', 'Payment Mode': 'Cash'
        },
        {
          'Sr. No.': 2, 'Name of the Student': 'Excel Date DOB', 'Std.': 'VI', 'Date of Birth': new Date('2015-08-15T00:00:00Z'),
          Medium: 'English', 'School & School Address': 'ABC School', 'Mob. No.': '9876543213',
          'Email ID': 'excel-dob@example.com', 'Payment Mode': 'Cash'
        },
        {
          'Sr. No.': 3, 'Name of the Student': 'Slash DOB', 'Std.': 'VII', 'Date of Birth': '15/08/2015',
          Medium: 'English', 'School & School Address': 'ABC School', 'Mob. No.': '9876543214',
          'Email ID': 'slash-dob@example.com', 'Payment Mode': 'Cash'
        },
        {
          'Sr. No.': 4, 'Name of the Student': 'Missing DOB', 'Std.': 'VIII', 'Date of Birth': '',
          Medium: 'English', 'School & School Address': 'ABC School', 'Mob. No.': '9876543215',
          'Email ID': 'missing-dob@example.com', 'Payment Mode': 'Cash'
        },
        {
          'Sr. No.': 5, 'Name of the Student': 'Invalid DOB', 'Std.': 'IX', 'Date of Birth': '31/02/2015',
          Medium: 'English', 'School & School Address': 'ABC School', 'Mob. No.': '9876543216',
          'Email ID': 'invalid-dob@example.com', 'Payment Mode': 'Cash'
        }
      ] })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.totalRecords, 5);
    assert.equal(payload.validRecords, 3);
    assert.equal(payload.invalidRecords, 2);
    assert.deepEqual(payload.preview.slice(0, 3).map(row => row.dob), ['2015-08-15', '2015-08-15', '2015-08-15']);
    assert.match(payload.errors.find(error => error.row === 4).message, /Missing DOB/);
    assert.match(payload.errors.find(error => error.row === 5).message, /Invalid DOB/);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Manual preview reports all missing DOB rows as invalid', async () => {
  const app = createServer({ pool: createFakePool() });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseRow = {
      'Name of the Student': 'Missing DOB', 'Std.': 'V', 'Date of Birth': '', Medium: 'English',
      'School & School Address': 'ABC School', 'Mob. No.': '987654329', 'Email ID': 'missing@example.com', 'Payment Mode': 'Cash'
    };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/manual-registration/preview`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [
        { ...baseRow, 'Sr. No.': 1, 'Mob. No.': '9876543201', 'Email ID': 'missing1@example.com' },
        { ...baseRow, 'Sr. No.': 2, 'Mob. No.': '9876543202', 'Email ID': 'missing2@example.com' },
        { ...baseRow, 'Sr. No.': 3, 'Mob. No.': '9876543203', 'Email ID': 'missing3@example.com' }
      ] })
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.totalRecords, 3);
    assert.equal(payload.validRecords, 0);
    assert.equal(payload.invalidRecords, 3);
    assert.equal(payload.errors.length, 3);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Student login uses Mobile + DOB and prevents cross-student result access', async () => {
  const fakePool = createFakePool({
    listStudents: [
      { reg_no: 'IMTSE-ONLINE-1', full_name: 'ONLINE STUDENT', student_class: 'VII', dob: '2014-08-15', whatsapp: '9000000001', status: 'Approved' },
      { reg_no: 'IMTSE-MANUAL-1', full_name: 'MANUAL STUDENT', student_class: 'III', dob: '2016-08-16', whatsapp: '9000000002', status: 'Approved & Active (Fees Paid)' }
    ]
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const unauthenticated = await fetch(`${baseUrl}/api/results/me`);
    assert.equal(unauthenticated.status, 401);
    const invalidLogin = await fetch(`${baseUrl}/api/student/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: '9000000001', dob: '2010-01-01' })
    });
    assert.equal(invalidLogin.status, 401);

    const onlineHeaders = await loginStudent(baseUrl, '9000000001', '2014-08-15');
    const own = await fetch(`${baseUrl}/api/results/me?regNo=IMTSE-ONLINE-1&dob=2014-08-15`, { headers: onlineHeaders });
    assert.equal(own.status, 200);
    const crossStudent = await fetch(`${baseUrl}/api/results/me?regNo=IMTSE-MANUAL-1&dob=2016-08-16`, { headers: onlineHeaders });
    assert.equal(crossStudent.status, 403);
    const manualHeaders = await loginStudent(baseUrl, '9000000002', '2016-08-16');
    const manualOwn = await fetch(`${baseUrl}/api/results/me?regNo=IMTSE-MANUAL-1`, { headers: manualHeaders });
    assert.equal(manualOwn.status, 200);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Manual registration preview rejects workbooks with missing required headers', async () => {
  const app = createServer({ pool: createFakePool() });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/manual-registration/preview`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ Name: 'Missing headers' }] })
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.errors[0].message, /Missing required columns/i);
    assert.match(payload.errors[0].message, /Date of Birth/i);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Manual registration preview rejects standards outside 1 through 10', async () => {
  const app = createServer({ pool: createFakePool() });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/manual-registration/preview`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{
        'Sr. No.': 1, 'Name of the Student': 'Out Of Range', 'Std.': '11', 'Date of Birth': '2015-08-15',
        Medium: 'English', 'School & School Address': 'ABC School', 'Mob. No.': '9876543299',
        'Email ID': 'out-of-range@example.com', 'Payment Mode': 'Cash'
      }] })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).errors[0].message, /Invalid Standard/);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Manual registration import generates a unique registration number and stores DOB for student login', async () => {
  const app = createServer({ pool: createFakePool() });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const port = server.address().port;
    const preview = await fetch(`http://127.0.0.1:${port}/api/admin/manual-registration/preview`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: [{
          'Sr. No.': 1,
          'Name of the Student': 'Manual Student',
          'Std.': 'VII',
          'Date of Birth': '2015-08-15',
          'Medium': 'English',
          'School & School Address': 'ABC School, Pune',
          'Mob. No.': '9988776655',
          'Email ID': 'manual@example.com',
          'Payment Mode': 'Cash'
        }]
      })
    });
    assert.equal(preview.status, 200);
    const previewPayload = await preview.json();
    assert.equal(previewPayload.validRecords, 1);
    assert.match(previewPayload.preview[0].status, /Ready|ready/i);

    const importRes = await fetch(`http://127.0.0.1:${port}/api/admin/manual-registration/import`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: previewPayload.preview })
    });

    assert.equal(importRes.status, 200);
    const importPayload = await importRes.json();
    assert.equal(importPayload.imported, 1);
    assert.match(importPayload.students[0].regNo, /^IMTSE-/);

    const listRes = await fetch(`http://127.0.0.1:${port}/api/students`);
    assert.equal(listRes.status, 200);
    const studentList = await listRes.json();
    const student = studentList.find(item => item.whatsapp === '9988776655');
    assert.ok(student);
    assert.equal(student.dob, '2015-08-15');

    const login = await fetch(`http://127.0.0.1:${port}/api/student/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: '9988776655', dob: '2015-08-15' })
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie') || '', /student_session=/);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Manual students flow through primary and secondary result release ownership rules', async () => {
  const previousStudents = global.__students;
  const previousResults = global.__student_results;
  const previousReleaseState = global.__release_controls;
  global.__students = [];
  global.__student_results = [];
  global.__release_controls = { hallTicketReleased: false, resultReleased: false };
  const app = createServer({ pool: { query: async sql => /SELECT \* FROM students ORDER BY/i.test(String(sql)) ? { rows: global.__students } : { rows: [] } } });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const rows = [
      {
        'Sr. No.': 1, 'Name of the Student': 'PRIMARY MANUAL', 'Std.': 'III', 'Date of Birth': '2016-08-15',
        Medium: 'English', 'School & School Address': 'PRIMARY SCHOOL', 'Mob. No.': '8111111111',
        'Email ID': 'primary-manual@example.com', 'Payment Mode': 'Cash'
      },
      {
        'Sr. No.': 2, 'Name of the Student': 'SECONDARY MANUAL', 'Std.': 'VII', 'Date of Birth': '2014-08-16',
        Medium: 'English', 'School & School Address': 'SECONDARY SCHOOL', 'Mob. No.': '8222222222',
        'Email ID': 'secondary-manual@example.com', 'Payment Mode': 'Cash'
      }
    ];
    const importResponse = await fetch(`${baseUrl}/api/admin/manual-registration/import`, {
      method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows })
    });
    assert.equal(importResponse.status, 200);
    const imported = await importResponse.json();
    assert.equal(imported.imported, 2);
    const primary = global.__students.find(student => student.student_class === 'III');
    const secondary = global.__students.find(student => student.student_class === 'VII');
    assert.ok(primary && secondary);

    const upload = (path, result) => fetch(`${baseUrl}${path}`, {
      method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ results: [result] })
    });
    assert.equal((await upload('/api/results/upload/primary', { registrationNo: primary.regNo, schoolName: 'PRIMARY SCHOOL', marathi: 40, english: 40, maths: 40, evs: 40, logicalReasoning: 40 })).status, 200);
    assert.equal((await upload('/api/results/upload/secondary', { registrationNo: secondary.regNo, schoolName: 'SECONDARY SCHOOL', marathi: 40, english: 40, mathsLogicalReasoning: 40, evsScience: 40, socialScience: 40 })).status, 200);

    for (const student of [primary, secondary]) {
      assert.equal((await fetch(`${baseUrl}/api/results/${student.regNo}/verify`, { method: 'POST', headers: adminHeaders })).status, 200);
      const studentHeaders = await loginStudent(baseUrl, student.whatsapp, student.dob);
      const beforeRelease = await fetch(`${baseUrl}/api/results/me?regNo=${student.regNo}&dob=${student.dob}`, { headers: studentHeaders });
      assert.equal((await beforeRelease.json()).published, false);
      assert.equal((await fetch(`${baseUrl}/api/results/me?regNo=${student.regNo}&dob=2010-01-01`, { headers: studentHeaders })).status, 403);
    }

    assert.equal((await fetch(`${baseUrl}/api/admin/release/result`, { method: 'POST', headers: adminHeaders })).status, 200);
    for (const student of [primary, secondary]) {
      const studentHeaders = await loginStudent(baseUrl, student.whatsapp, student.dob);
      const result = await fetch(`${baseUrl}/api/results/me?regNo=${student.regNo}&dob=${student.dob}`, { headers: studentHeaders });
      assert.equal((await result.json()).published, true);
      const otherDob = student === primary ? secondary.dob : primary.dob;
      assert.equal((await fetch(`${baseUrl}/api/results/me?regNo=${student.regNo}&dob=${otherDob}`, { headers: studentHeaders })).status, 403);
    }

    const newImport = await fetch(`${baseUrl}/api/admin/manual-registration/import`, {
      method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [{ ...rows[0], 'Sr. No.': 3, 'Name of the Student': 'NEW AFTER RELEASE', 'Mob. No.': '8333333333', 'Email ID': 'new-after-release@example.com' }] })
    });
    assert.equal(newImport.status, 200);
    const newStudent = global.__students.find(student => student.whatsapp === '8333333333');
    assert.equal((await upload('/api/results/upload/primary', { registrationNo: newStudent.regNo, schoolName: 'PRIMARY SCHOOL', marathi: 35, english: 35, maths: 35, evs: 35, logicalReasoning: 35 })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/results/${newStudent.regNo}/verify`, { method: 'POST', headers: adminHeaders })).status, 200);
    const newHeaders = await loginStudent(baseUrl, newStudent.whatsapp, newStudent.dob);
    const newBeforeRelease = await fetch(`${baseUrl}/api/results/me?regNo=${newStudent.regNo}&dob=${newStudent.dob}`, { headers: newHeaders });
    assert.equal((await newBeforeRelease.json()).published, false);
  } finally {
    global.__students = previousStudents;
    global.__student_results = previousResults;
    global.__release_controls = previousReleaseState;
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Global release controls require admin access and release Hall Tickets/results together', async () => {
  const previousResults = global.__student_results;
  global.__student_results = [
    { reg_no: 'IMTSE-REL3', student_name: 'PRIMARY', className: 'III', marathi: 40, english: 40, maths: 40, evs: 40, logicalReasoning: 40, total_marks: 200, status: 'DRAFT' },
    { reg_no: 'IMTSE-REL7', student_name: 'SECONDARY', className: 'VII', marathi: 30, english: 30, maths: 30, evsScience: 30, socialScience: 30, logicalReasoning: 50, total_marks: 200, status: 'VERIFIED' }
  ];
  const fakePool = createFakePool({
    listStudents: [
      { reg_no: 'IMTSE-REL3', full_name: 'PRIMARY', student_class: 'III', dob: '2014-08-15', whatsapp: '9444444444', school_name: 'SCHOOL' },
      { reg_no: 'IMTSE-REL7', full_name: 'SECONDARY', student_class: 'VII', dob: '2014-08-16', whatsapp: '9555555555', school_name: 'SCHOOL' }
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

    const ownHeaders = await loginStudent(baseUrl, '9444444444', '2014-08-15');
    const ownResult = await fetch(`${baseUrl}/api/results/me?regNo=IMTSE-REL3&dob=2014-08-15`, { headers: ownHeaders });
    assert.equal((await ownResult.json()).result.regNo, 'IMTSE-REL3');
    const otherResult = await fetch(`${baseUrl}/api/results/me?regNo=IMTSE-REL7&dob=2014-08-15`, { headers: ownHeaders });
    assert.equal(otherResult.status, 403);
  } finally {
    global.__student_results = previousResults;
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Persisted release state is the default source and controls remain independent', async () => {
  const previousReleaseState = global.__release_controls;
  global.__release_controls = { hallTicketReleased: true, resultReleased: true };
  const fakePool = createFakePool({
    releaseState: { hall_ticket_released: false, result_released: false }
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const initial = await fetch(`${baseUrl}/api/admin/release-status`, { headers: adminHeaders });
    assert.deepEqual(await initial.json(), { hallTicketReleased: false, resultReleased: false });

    const releaseHallTicket = await fetch(`${baseUrl}/api/admin/release/hall-ticket`, { method: 'POST', headers: adminHeaders });
    assert.equal(releaseHallTicket.status, 200);
    const stateAfterHallTicket = await releaseHallTicket.json();
    assert.deepEqual({ hallTicketReleased: stateAfterHallTicket.hallTicketReleased, resultReleased: stateAfterHallTicket.resultReleased }, { hallTicketReleased: true, resultReleased: false });
  } finally {
    global.__release_controls = previousReleaseState;
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

/**
 * Creates a fake PostgreSQL-like pool that handles the SQL patterns used by the app.
 * This keeps the project test coverage aligned with the PostgreSQL migration while
 * preserving the same route contracts and validation logic.
 */
function createFakePool(customHandlers = {}) {
  const state = {
    resources: (customHandlers.resources || []).map(resource => ({ ...resource })),
    emailQueue: []
  };

  const pool = {
    query: async (sql, params) => {
      const normalizedSql = String(sql || '').trim();

      if (/SELECT\s+1/i.test(normalizedSql)) {
        return { rows: [{ '?column?': 1 }] };
      }

      if (/SELECT\s+hall_ticket_released,\s*result_released\s+FROM\s+release_controls/i.test(normalizedSql) && customHandlers.releaseState) {
        return { rows: [customHandlers.releaseState] };
      }

      if (/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(normalizedSql) || /ALTER\s+TABLE\s+students\s+ADD\s+COLUMN/i.test(normalizedSql)) {
        return { rows: [] };
      }

      if (/ALTER\s+TABLE\s+student_results\s+ADD\s+COLUMN/i.test(normalizedSql)) {
        return { rows: [] };
      }

      if (/UPDATE\s+(students|student_results)\s+SET\s+.*released_at/i.test(normalizedSql)) {
        return { rows: [], rowCount: 0 };
      }

      if (/INSERT\s+INTO\s+admin_users/i.test(normalizedSql)) {
        return { rows: [] };
      }

      if (/INSERT\s+INTO\s+study_resources/i.test(normalizedSql)) {
        const [title, category, resource_type, url, description, file_name, file_data] = params;
        const id = state.resources.length ? Math.max(...state.resources.map(resource => resource.id)) + 1 : 1;
        state.resources.push({ id, title, category, resource_type, url, description, file_name, file_data, created_at: new Date().toISOString() });
        return { rows: [{ id }] };
      }

      if (/INSERT\s+INTO\s+email_queue/i.test(normalizedSql)) {
        const [studentId, registrationNumber, studentName, emailAddress, registrationType, emailType, status] = params;
        state.emailQueue.push({ student_id: studentId, registration_number: registrationNumber, student_name: studentName, email_address: emailAddress, registration_type: registrationType, email_type: emailType, status });
        return { rows: [{ id: state.emailQueue.length, status, created_at: new Date().toISOString() }] };
      }

      if (/UPDATE\s+email_queue/i.test(normalizedSql)) {
        const [status, retryCount, lastError, studentId, registrationNumber] = params;
        state.emailQueue.filter(entry => entry.student_id === studentId && entry.registration_number === registrationNumber).forEach(entry => Object.assign(entry, { status, retry_count: retryCount, last_error: lastError }));
        return { rows: [] };
      }

      if (/SELECT\s+student_name,\s*registration_number,\s*email_address/i.test(normalizedSql)) {
        return { rows: state.emailQueue.filter(entry => ['PENDING', 'WAITING'].includes(entry.status)) };
      }

      if (/SELECT\s+COUNT\(\*\)\s+FILTER/i.test(normalizedSql)) {
        return { rows: [{
          sent: state.emailQueue.filter(entry => entry.status === 'SENT').length,
          waiting: state.emailQueue.filter(entry => ['PENDING', 'WAITING'].includes(entry.status)).length,
          failed: state.emailQueue.filter(entry => entry.status === 'FAILED').length
        }] };
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

      if (/UPDATE\s+study_resources\s+SET/i.test(normalizedSql)) {
        const [title, category, resource_type, url, description, file_name, file_data, id] = params;
        const resource = state.resources.find(item => item.id === id);
        if (!resource) return { rows: [], rowCount: 0 };
        Object.assign(resource, { title, category, resource_type, url, description, file_name, file_data });
        return { rows: [{ ...resource }], rowCount: 1 };
      }

      if (/DELETE\s+FROM\s+study_resources/i.test(normalizedSql)) {
        const id = params[0];
        const index = state.resources.findIndex(resource => resource.id === id);
        if (index === -1) return { rows: [], rowCount: 0 };
        state.resources.splice(index, 1);
        return { rows: [], rowCount: 1 };
      }

      if (/SELECT\s+\*\s+FROM\s+study_resources/i.test(normalizedSql)) {
        if (/WHERE\s+id\s*=\s*\$1/i.test(normalizedSql)) {
          const resource = state.resources.find(item => item.id === params[0]);
          return { rows: resource ? [{ ...resource }] : [] };
        }
        return { rows: state.resources.map(resource => ({ ...resource })) };
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
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
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
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
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
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
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

test('PUT /api/resources/:id updates title, class, and type and persists the edit', async () => {
  const fakePool = createFakePool({ resources: [{
    id: 41,
    title: 'Old title',
    category: 'std-i-ii',
    resource_type: 'PDF',
    url: 'https://example.com/old.pdf',
    description: 'Old description',
    file_name: 'old.pdf',
    file_data: 'data:application/pdf;base64,old'
  }] });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/resources/41`, {
      method: 'PUT',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated title', category: 'std-vii-viii', type: 'DOC', description: 'Updated description' })
    });

    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.deepEqual({ title: updated.title, category: updated.category, type: updated.type }, {
      title: 'Updated title', category: 'std-vii-viii', type: 'DOC'
    });

    const persisted = await fetch(`${baseUrl}/api/resources`);
    assert.equal(persisted.status, 200);
    const resources = await persisted.json();
    assert.deepEqual(resources[0], {
      id: 41,
      title: 'Updated title',
      category: 'std-vii-viii',
      type: 'DOC',
      url: 'https://example.com/old.pdf',
      description: 'Updated description',
      fileName: 'old.pdf',
      fileData: 'data:application/pdf;base64,old'
    });
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('PUT /api/resources/:id keeps the existing file when no replacement is uploaded', async () => {
  const fakePool = createFakePool({ resources: [{
    id: 42,
    title: 'Worksheet',
    category: 'std-iii-iv',
    resource_type: 'PDF',
    url: 'https://example.com/worksheet.pdf',
    description: 'Keep this file',
    file_name: 'worksheet.pdf',
    file_data: 'data:application/pdf;base64,keep'
  }] });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/resources/42`, {
      method: 'PUT',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed worksheet', category: 'std-iii-iv', type: 'PDF' })
    });

    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.fileName, 'worksheet.pdf');
    assert.equal(updated.fileData, 'data:application/pdf;base64,keep');
    assert.equal(updated.url, 'https://example.com/worksheet.pdf');
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('DELETE /api/resources/:id returns an explicit success contract and persists removal', async () => {
  const fakePool = createFakePool({ resources: [{
    id: 43,
    title: 'To remove',
    category: 'std-v-vi',
    resource_type: 'DOC',
    url: '',
    description: '',
    file_name: 'remove.docx',
    file_data: 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,remove'
  }] });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/resources/43`, { method: 'DELETE', headers: adminHeaders });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      deleted: true,
      id: 43,
      message: 'Resource deleted successfully'
    });

    const persisted = await fetch(`${baseUrl}/api/resources`);
    assert.deepEqual(await persisted.json(), []);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('DELETE /api/resources/:id returns 404 and success false for a missing resource', async () => {
  const fakePool = createFakePool();
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/resources/999`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      success: false,
      deleted: false,
      id: 999,
      error: 'Resource not found.'
    });
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('POST /api/results/upload calculates a senior 200-mark total with combined maths and logical reasoning', async () => {
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
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: [{
          registrationNo: 'IMTSE-10001',
          schoolName: 'TEST SCHOOL',
          marathi: 40,
          english: 40,
          mathsLogicalReasoning: 40,
          evsScience: 40,
          socialScience: 40
        }]
      })
    });

    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const payload = JSON.parse(responseText);
    assert.equal(payload.validStudents, 1);
    assert.equal(payload.summary.total, 200);
    assert.equal(payload.results[0].totalMarks, 200);
    assert.equal(payload.results[0].mathsLogicalReasoning, 40);
    assert.equal(payload.results[0].percentage, undefined);
    assert.equal(payload.results[0].resultStatus, undefined);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('Result mutation endpoints require admin authorization', async () => {
  const fakePool = createFakePool({
    listStudents: [{ reg_no: 'IMTSE-SECURITY', full_name: 'SECURITY USER', student_class: 'VII', school_name: 'SECURITY SCHOOL' }]
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const endpoints = [
      '/api/results/upload',
      '/api/results/upload/primary',
      '/api/results/upload/secondary',
      '/api/results/IMTSE-SECURITY/verify',
      '/api/results/IMTSE-SECURITY/publish',
      '/api/results/publish-all'
    ];
    for (const endpoint of endpoints) {
      const body = endpoint.includes('/upload') ? JSON.stringify({ results: [] }) : undefined;
      const unauthenticated = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      assert.equal(unauthenticated.status, 401, endpoint);
      const forbidden = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from('student:wrong').toString('base64')}`, 'Content-Type': 'application/json' },
        body
      });
      assert.equal(forbidden.status, 403, endpoint);
    }

    const adminUpload = await fetch(`${baseUrl}/api/results/upload`, {
      method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ results: [] })
    });
    assert.equal(adminUpload.status, 200);
    const adminPublishAll = await fetch(`${baseUrl}/api/results/publish-all`, { method: 'POST', headers: adminHeaders });
    assert.equal(adminPublishAll.status, 200);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
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
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
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
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
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
      registrationNo: 'IMTSE-GROUP7', marathi: 40, english: 40, mathsLogicalReasoning: 40,
      evsScience: 40, socialScience: 40
    });
    assert.equal(secondaryValid.status, 200);
    assert.equal((await secondaryValid.json()).results[0].totalMarks, 200);

    const secondaryTooHigh = await post('/api/results/upload/secondary', {
      registrationNo: 'IMTSE-GROUP7', marathi: 41, english: 40, mathsLogicalReasoning: 40,
      evsScience: 40, socialScience: 40
    });
    assert.equal(secondaryTooHigh.status, 400);
    assert.match((await secondaryTooHigh.json()).errors[0].message, /Invalid marks for: Marathi="41"/);
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
      method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ results: [result] })
    });
    assert.equal((await upload('primary', { registrationNo: 'IMTSE-PUBLISH3', marathi: 40, english: 40, maths: 40, evs: 40, logicalReasoning: 40 })).status, 200);
    assert.equal((await upload('secondary', { registrationNo: 'IMTSE-PUBLISH7', marathi: 40, english: 40, mathsLogicalReasoning: 40, evsScience: 40, socialScience: 40 })).status, 200);
    assert.equal(global.__student_results.filter(result => result.status === 'DRAFT').length, 2);

    for (const regNo of ['IMTSE-PUBLISH3', 'IMTSE-PUBLISH7']) {
      assert.equal((await fetch(`${baseUrl}/api/results/${regNo}/verify`, { method: 'POST', headers: adminHeaders })).status, 200);
    }
    const publishResponse = await fetch(`${baseUrl}/api/results/publish-all`, { method: 'POST', headers: adminHeaders });
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
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
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
    assert.match(primaryTemplateRes.headers.get('content-type'), /spreadsheetml/);
    const primaryWorkbook = XLSX.read(Buffer.from(await primaryTemplateRes.arrayBuffer()), { type: 'buffer' });
    const primaryRows = XLSX.utils.sheet_to_json(primaryWorkbook.Sheets.Results, { header: 1, defval: '' });
    assert.deepEqual(primaryRows[0], ['Registration No', 'Student Name', 'School Name', 'Standard', 'Medium', 'Payment Mode', 'Marathi', 'English', 'Maths', 'EVS', 'Logical Reasoning', 'Total']);
    assert.equal(primaryRows.some(row => row[0] === 'IMTSE-10002'), true);
    assert.equal(primaryRows.some(row => row[0] === 'IMTSE-10001'), false);

    const secondaryTemplateRes = await fetch(`http://127.0.0.1:${port}/api/results/template/secondary`);
    assert.equal(secondaryTemplateRes.status, 200);
    assert.match(secondaryTemplateRes.headers.get('content-type'), /spreadsheetml/);
    const secondaryWorkbook = XLSX.read(Buffer.from(await secondaryTemplateRes.arrayBuffer()), { type: 'buffer' });
    const secondaryRows = XLSX.utils.sheet_to_json(secondaryWorkbook.Sheets.Results, { header: 1, defval: '' });
    assert.deepEqual(secondaryRows[0], ['Registration No', 'Student Name', 'School Name', 'Standard', 'Medium', 'Payment Mode', 'Marathi', 'English', 'Maths & Logical Reasoning', 'EVS / Science', 'Social Science', 'Total']);
    assert.equal(secondaryRows.some(row => row[0] === 'IMTSE-10001'), true);
    assert.equal(secondaryRows.some(row => row[0] === 'IMTSE-10002'), false);
    const secondaryMarkIndexes = [6, 7, 8, 9, 10, 11];
    assert.equal(secondaryRows.slice(1).every(row => secondaryMarkIndexes.every(index => row[index] === '')), true);
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
    const baseUrl = `http://127.0.0.1:${port}`;
    const studentHeaders = await loginStudent(baseUrl, '1234567890', '2014-08-15');
    const response = await fetch(`${baseUrl}/api/results/me?regNo=IMTSE-10001&dob=2014-08-15`, { headers: studentHeaders });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.student.regNo, 'IMTSE-10001');

    const forbidden = await fetch(`${baseUrl}/api/results/me?regNo=IMTSE-99999&dob=2014-08-15`, { headers: studentHeaders });
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
    const templateWorkbook = XLSX.read(Buffer.from(await templateRes.arrayBuffer()), { type: 'buffer' });
    const templateRows = XLSX.utils.sheet_to_json(templateWorkbook.Sheets.Results, { header: 1, defval: '' });
    assert.equal(templateRows[0][0], 'Registration No');
    assert.equal(templateRows.some(row => row[0] === 'IMTSE-34990'), true);
    assert.equal(templateRows.flat().some(value => /Gender/i.test(String(value))), false);

    const uploadRes = await fetch(`http://127.0.0.1:${port}/api/results/upload`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: [
            { 'Reg. No': 'IMTSE-34990', Marathi: '30', English: '30', 'Maths & Logical Reasoning': '30', EVS: '30', 'Social Science': '30', 'School Name': 'ABC School' },
            { 'Registration Number': 'IMTSE-34991', Marathi: '30', English: '30', 'Maths & Logical Reasoning': '30', 'EVS / Science': '30', 'Social Science': '30', 'School Name': 'XYZ School' },
          { 'Registration No': '', 'Mathematics': '', 'English': '', 'Science': '', 'School Name': '' },
          { 'Reg No': 'IMTSE-99999', Marathi: '30', English: '30', 'Maths & Logical Reasoning': '30', 'EVS / Science': '30', 'Social Science': '30', 'School Name': 'ABC School' }
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
    const primaryTemplateResponse = await fetch(`${baseUrl}/api/results/template/primary`);
    const primaryWorkbook = XLSX.read(Buffer.from(await primaryTemplateResponse.arrayBuffer()), { type: 'buffer' });
    const primaryMatrix = XLSX.utils.sheet_to_json(primaryWorkbook.Sheets.Results, { header: 1, defval: '' });
    const primaryTemplateRows = primaryMatrix.slice(1).map(values => Object.fromEntries(primaryMatrix[0].map((header, index) => [header, values[index] || ''])));
    const secondaryTemplateResponse = await fetch(`${baseUrl}/api/results/template/secondary`);
    const secondaryWorkbook = XLSX.read(Buffer.from(await secondaryTemplateResponse.arrayBuffer()), { type: 'buffer' });
    const secondaryMatrix = XLSX.utils.sheet_to_json(secondaryWorkbook.Sheets.Results, { header: 1, defval: '' });
    const secondaryTemplateRows = secondaryMatrix.slice(1).map(values => Object.fromEntries(secondaryMatrix[0].map((header, index) => [header, values[index] || ''])));
    const makeRow = (templateRow, values) => ({
      ...templateRow,
      ...Object.fromEntries(Object.entries(values).map(([header, value]) => [header, String(value)]))
    });

    const uploadResponse = await fetch(`${baseUrl}/api/results/upload`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: [
        makeRow(primaryTemplateRows[0], {
          'Registration No': 'IMTSE-30001', 'School Name': 'PRIMARY SCHOOL',
          Marathi: 35, English: 36, Maths: 38, 'EVS / Science': 37, 'Logical Reasoning': 39
        }),
        makeRow(secondaryTemplateRows[0], {
          'Registration No': 'IMTSE-70001', 'School Name': 'SECONDARY SCHOOL',
          Marathi: 25, English: 28, 'Maths & Logical Reasoning': 25, 'EVS / Science': 26, 'Social Science': 24
        })
      ] })
    });

    assert.equal(uploadResponse.status, 200);
    const payload = await uploadResponse.json();
    assert.equal(payload.validStudents, 2);
    assert.equal(payload.results[0].totalMarks, 185);
    assert.equal(payload.results[0].evs, 37);
    assert.equal(payload.results[0].evsScience, undefined);
    assert.equal(payload.results[1].totalMarks, 128);
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
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: [canonicalRow] })
    });

    const responseText = await response.text();
    assert.equal(response.status, 400, responseText);
    const payload = JSON.parse(responseText);
    assert.match(payload.errors[0].message, /Invalid marks for: Maths & Logical Reasoning="63"/);
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
      status: 'DRAFT',
      result_released_at: '2026-09-18T00:00:00.000Z'
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
      status: 'PUBLISHED',
      result_released_at: '2026-09-18T00:00:00.000Z'
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
    const baseUrl = `http://127.0.0.1:${port}`;
    const unpublishedHeaders = await loginStudent(baseUrl, '1234567890', '2014-08-15');
    const unpublished = await fetch(`${baseUrl}/api/results/me?regNo=IMTSE-10001&dob=2014-08-15`, { headers: unpublishedHeaders });
    assert.equal(unpublished.status, 200);
    const unpublishedPayload = await unpublished.json();
    assert.equal(unpublishedPayload.published, false);
    assert.equal(unpublishedPayload.result, null);

    const publishedHeaders = await loginStudent(baseUrl, '1111111111', '2014-08-14');
    const published = await fetch(`${baseUrl}/api/results/me?regNo=IMTSE-10002&dob=2014-08-14`, { headers: publishedHeaders });
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

test('GET /api/certificate returns an approved student certificate and rejects wrong DOB', async () => {
  const fakePool = createFakePool({
    listStudents: [{
      reg_no: 'IMTSE-CERT-1', full_name: 'CERTIFICATE STUDENT', student_class: 'IV', medium: 'English',
      school_name: 'CERTIFICATE SCHOOL', dob: '2015-08-15', whatsapp: '9888888888', status: 'Approved & Active (Fees Paid)'
    }]
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const studentHeaders = await loginStudent(baseUrl, '9888888888', '2015-08-15');
    const denied = await fetch(`${baseUrl}/api/certificate?regNo=IMTSE-CERT-1&dob=2014-08-15`, { headers: studentHeaders });
    assert.equal(denied.status, 403);
    const response = await fetch(`${baseUrl}/api/certificate?regNo=IMTSE-CERT-1&dob=2015-08-15`, { headers: studentHeaders });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/pdf/);
    assert.match(response.headers.get('content-disposition'), /IMTSE_Certificate_IMTSE-CERT-1\.pdf/);
    assert.ok((await response.arrayBuffer()).byteLength > 500);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
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

test('Hall Ticket access is blocked until global release and returns the fixed exam center after release', async () => {
  const previousReleaseState = global.__release_controls;
  global.__release_controls = { hallTicketReleased: false, resultReleased: false };
  process.env.HALL_TICKET_UNLOCK_DATE = '01-01-2020 00:00 Asia/Kolkata';
  const fakePool = createFakePool({
    listStudents: [{
      reg_no: 'IMTSE-HALL-1', full_name: 'HALL USER', student_class: 'VII', medium: 'English',
      school_name: 'REGISTERED SCHOOL', dob: '2014-08-15', whatsapp: '9777777777', status: 'Approved & Active (Fees Paid)',
      hall_ticket_released_at: '2026-09-18T00:00:00.000Z'
    }]
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const studentHeaders = await loginStudent(baseUrl, '9777777777', '2014-08-15');
    const beforeRelease = await fetch(`${baseUrl}/api/hall-ticket?regNo=IMTSE-HALL-1&dob=2014-08-15`, { headers: studentHeaders });
    assert.equal(beforeRelease.status, 403);
    global.__release_controls.hallTicketReleased = true;
    const afterRelease = await fetch(`${baseUrl}/api/hall-ticket?regNo=IMTSE-HALL-1&dob=2014-08-15`, { headers: studentHeaders });
    assert.equal(afterRelease.status, 200);
    assert.equal((await afterRelease.json()).examCenter, 'Matoshree Tanubai Dagadu Khade English School and Junior College, Sainandan Colony, Near Rama Udyan, Miraj');
  } finally {
    global.__release_controls = previousReleaseState;
    delete process.env.HALL_TICKET_UNLOCK_DATE;
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('Student result readback maps PostgreSQL subject columns and preserves zero marks', async () => {
  const previousReleaseState = global.__release_controls;
  global.__release_controls = { hallTicketReleased: false, resultReleased: true };
  const previousResults = global.__student_results;
  global.__student_results = [{
    reg_no: 'IMTSE-RESULT-1', student_name: 'RESULT USER', marathi: 0, english: 30, maths: 29,
    evs_science: 28, social_science: 27, logical_reasoning: 45, total_marks: 159, status: 'PUBLISHED',
    result_released_at: '2026-09-18T00:00:00.000Z'
  }];
  const fakePool = createFakePool({
    listStudents: [{ reg_no: 'IMTSE-RESULT-1', full_name: 'RESULT USER', student_class: 'VII', medium: 'English', dob: '2014-08-15', whatsapp: '9666666666', status: 'Approved' }]
  });
  const app = createServer({ pool: fakePool });
  const server = await new Promise(resolve => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const studentHeaders = await loginStudent(baseUrl, '9666666666', '2014-08-15');
    const response = await fetch(`${baseUrl}/api/results/me?regNo=IMTSE-RESULT-1&dob=2014-08-15`, { headers: studentHeaders });
    assert.equal(response.status, 200);
    const result = (await response.json()).result;
    assert.deepEqual({ marathi: result.marathi, english: result.english, maths: result.maths, evsScience: result.evsScience, socialScience: result.socialScience, logicalReasoning: result.logicalReasoning, totalMarks: result.totalMarks }, {
      marathi: 0, english: 30, maths: 29, evsScience: 28, socialScience: 27, logicalReasoning: 29, totalMarks: 159
    });
  } finally {
    global.__release_controls = previousReleaseState;
    global.__student_results = previousResults;
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
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

