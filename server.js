const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');
const PDFDocument = require('pdfkit');
const axios = require('axios');
const { SUBJECT_GROUPS, normalizeResultHeader, getGroupForClass } = require('./result-subjects.js');

// Load Hall Ticket configuration
const hallTicketConfig = require('./hallTicketConfig.js');

dotenv.config({ path: path.join(__dirname, '.env') });

// In-memory fallbacks
if (!global.__students) global.__students = [];
if (!global.__resources) global.__resources = [];
if (!global.__student_results) global.__student_results = [];

const RESULT_FORMATS = {
  junior: SUBJECT_GROUPS.PRIMARY,
  senior: SUBJECT_GROUPS.SECONDARY
};

const MAX_RESULT_TOTAL = 200;

let connectionPool = null;
let isDbConnected = false;
let dbInitError = null;
let injectedEmailTransporter = null;

function getQueryRows(result) {
  if (!result) return [];
  if (Array.isArray(result)) return Array.isArray(result[0]) ? result[0] : [];
  return Array.isArray(result.rows) ? result.rows : [];
}

function setInjectedEmailTransporter(transporter) {
  injectedEmailTransporter = transporter;
}

function getSenderEmail() {
  return process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER || process.env.SMTP_FROM || '';
}

async function sendApprovalEmail(student) {
  const studentEmail = student.email || student.studentEmail || student.emailAddress;
  console.log('[EMAIL] Approval email requested', {
    regNo: student.reg_no || student.regNo || student.regno || '',
    studentEmail,
    studentName: student.full_name || student.fullName || student.name || 'Student'
  });

  if (!studentEmail) {
    console.warn('[EMAIL] No email address found for student:', student.reg_no || student.regNo || student.regno || 'unknown');
    return { ok: false, reason: 'no-email' };
  }

  const studentName = student.full_name || student.fullName || student.name || 'Student';
  const regNo = student.reg_no || student.regNo || student.regno || '';

  let pdfBuffer;
  try {
    pdfBuffer = await generateRegistrationPdfBuffer(student);
  } catch (e) {
    console.error('[EMAIL] Failed to generate registration PDF', e && e.message ? e.message : e);
    return { ok: false, reason: 'pdf-failed' };
  }

  const emailBody = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#0f2b5c,#1a4a9a);color:white;padding:28px;text-align:center;border-radius:10px 10px 0 0;">
      <h1 style="margin:0;font-size:22px;">IGNITED MINDS TALENT SEARCH EXAM</h1>
      <p style="margin:6px 0 0;opacity:0.85;font-size:14px;">2026-27 | MTDK Shaikshnik Sankul</p>
    </div>
    <div style="padding:28px;background:#fff;border:1px solid #e2e8f0;border-top:none;">
      <p style="font-size:16px;color:#1a1a2e;">Hello <strong>${studentName}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.7;">
        Thank you for registering for the <strong>Ignited Minds Talent Search Exam (IMTSE) 2026-27</strong>.<br>
        Your registration has been reviewed and <strong style="color:#16a34a;">approved</strong> by the admin.
      </p>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:20px 0;text-align:center;">
        <p style="margin:0;font-size:13px;color:#1e40af;">Your Registration Number</p>
        <p style="margin:6px 0 0;font-size:28px;font-weight:800;color:#0f2b5c;letter-spacing:2px;">${regNo}</p>
      </div>
      <p style="color:#475569;font-size:14px;line-height:1.9;">
        Exam Date: <strong>14 February 2027</strong><br>
        Time: <strong>11:00 AM to 1:00 PM</strong><br>
        Exam Centre: <strong>MTDK School</strong><br>
        Admit Card Available From: <strong>${hallTicketConfig.getHallTicketUnlockDateDisplay()}</strong>
      </p>
      <p style="color:#475569;font-size:14px;">Your official registration PDF is attached to this email.</p>
      <div style="margin-top:20px;padding:14px;background:#fef9c3;border-left:4px solid #f59e0b;border-radius:4px;font-size:13px;color:#92400e;">
        Please carry your admit card and a valid photo ID on the day of the exam.
      </div>
    </div>
    <div style="text-align:center;padding:16px;font-size:12px;color:#94a3b8;">
      This is an automated email. Please do not reply to this email.<br>
      Initiative by MTDK Shaikshnik Sankul
    </div>
  </div>`;

  try {
    if (injectedEmailTransporter && typeof injectedEmailTransporter.sendMail === 'function') {
      const mailResult = await injectedEmailTransporter.sendMail({
        from: getSenderEmail() || 'ignitedmind.mtdk@gmail.com',
        to: studentEmail,
        subject: `IMTSE 2026-27 - Registration Confirmed | Reg No. ${regNo}`,
        html: emailBody,
        attachments: [{
          filename: `IMTSE_Registration_${regNo}.pdf`,
          content: pdfBuffer
        }]
      });
      console.log('[EMAIL] Sent via injected transporter successfully', mailResult && mailResult.messageId ? { messageId: mailResult.messageId } : 'no-message-id');
      return {
        ok: true,
        messageId: mailResult && mailResult.messageId ? mailResult.messageId : null
      };
    }

    if (!process.env.BREVO_API_KEY) {
      throw new Error('BREVO_API_KEY is missing from environment variables');
    }

    console.log('[EMAIL] BREVO_API_KEY configured:', !!process.env.BREVO_API_KEY);

    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: {
          name: 'MTDK Shaikshnik Sankul',
          email: 'ignitedmind.mtdk@gmail.com'
        },
        to: [
          {
            email: studentEmail,
            name: studentName
          }
        ],
        subject: `IMTSE 2026-27 - Registration Confirmed | Reg No. ${regNo}`,
        htmlContent: emailBody,
        attachment: [
          {
            name: `IMTSE_Registration_${regNo}.pdf`,
            content: pdfBuffer.toString('base64')
          }
        ]
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('[EMAIL] Sent successfully', response && response.data ? { status: response.status, dataSummary: response.data } : 'no-response');
    return {
      ok: true,
      messageId: response.data && response.data.messageId ? response.data.messageId : null
    };
  } catch (e) {
    const errorMessage = e && e.message ? e.message : String(e);
    console.error('[EMAIL] Mail send failed:', errorMessage);
    if (e && e.response) {
      try {
        const respStatus = e.response.status;
        const respData = e.response.data;
        console.error('[EMAIL] Brevo response status:', respStatus);
        console.error('[EMAIL] Brevo response data:', respData);
      } catch (innerErr) {}
    }
    return { ok: false, reason: 'send-failed', error: errorMessage };
  }
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  const asString = String(value).trim();
  if (!asString) return null;

  const isoMatch = asString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return asString;

  const tIndex = asString.indexOf('T');
  let candidate = asString;
  if (tIndex !== -1) candidate = asString.substring(0, tIndex);
  if (candidate.indexOf(' ') !== -1) candidate = candidate.split(' ')[0];
  const isoLike = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoLike) return candidate;

  const dmMatch = asString.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (dmMatch) return `${dmMatch[3]}-${dmMatch[2]}-${dmMatch[1]}`;

  const monthNames = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12
  };
  const cleaned = asString.replace(/[,]/g, '').replace(/\s+/g, ' ').trim();
  const humanMatch = cleaned.match(/^([0-9]{1,2})[- ]([A-Za-z]+)[- ]([0-9]{4})$/);
  if (humanMatch) {
    const day = Number(humanMatch[1]);
    const monthRaw = humanMatch[2].toLowerCase();
    const year = Number(humanMatch[3]);
    const month = monthNames[monthRaw];
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

function formatDateWithDay(value) {
  if (!value) return '';
  const normalized = normalizeDate(value) || String(value).trim();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return String(value).trim();
  }
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  return parsed.toLocaleDateString('en-IN', options);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getClassNumber(value = '') {
  const normalized = String(value || '').trim().toUpperCase();
  const romanClasses = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  const numericMatch = normalized.match(/(?:CLASS\s*)?(10|[1-9])(?:ST|ND|RD|TH)?/);
  if (numericMatch) return Number(numericMatch[1]);
  const romanMatch = normalized.match(/\b(I{1,3}|IV|V?I{0,3}|IX|X)\b/);
  return romanMatch ? romanClasses[romanMatch[1]] || null : null;
}

function getResultSubjects(studentClass = '') {
  return getGroupForClass(studentClass) === 'PRIMARY' ? RESULT_FORMATS.junior : RESULT_FORMATS.senior;
}

function getResultMarksFromInput(rawMarks = {}, studentClass = '') {
  const marks = {};
  const group = getGroupForClass(studentClass);
  getResultSubjects(studentClass).forEach(subject => {
    const entries = Object.entries(rawMarks || {});
    const hasValue = value => value !== undefined && value !== null && String(value).trim() !== '';
    let match = entries.find(([header, value]) => normalizeResultHeader(header) === subject.field && hasValue(value));
    if (!match && subject.field === 'evs' && group === 'PRIMARY') {
      match = entries.find(([header, value]) => normalizeResultHeader(header) === 'evs_science' && hasValue(value));
    }
    if (!match && subject.field === 'evs_science' && group === 'SECONDARY') {
      match = entries.find(([header, value]) => normalizeResultHeader(header) === 'evs' && hasValue(value));
    }
    const parsed = toNumber(match ? match[1] : undefined);
    marks[subject.apiKey] = parsed !== null && parsed >= 0 && parsed <= subject.maxMarks ? parsed : null;
  });
  return marks;
}

function calculateResultSummary(rawMarks = {}, studentClass = '') {
  const subjects = getResultSubjects(studentClass);
  const marks = getResultMarksFromInput(rawMarks, studentClass);
  return {
    ...marks,
    totalMarks: subjects.reduce((total, subject) => total + (marks[subject.apiKey] ?? 0), 0)
  };
}

function serializeResultRecord(row, studentClass = '') {
  if (!row) return null;
  const resolvedClass = studentClass || row.className || row.standard || '';
  const subjects = getResultSubjects(resolvedClass);
  const subjectMarks = {};
  subjects.forEach(subject => {
    const legacyValue = subject.key === 'maths' ? row.mathematics : subject.key === 'evsScience' ? row.science : undefined;
    subjectMarks[subject.apiKey] = toNumber(row[subject.apiKey] ?? legacyValue);
  });
  const status = String(row.status || 'DRAFT').toUpperCase();

  return {
    id: row.id,
    regNo: row.reg_no || row.regNo,
    studentName: row.student_name || row.studentName || '',
    className: resolvedClass,
    ...subjectMarks,
    totalMarks: Number(row.total_marks ?? 0),
    status,
    verifiedAt: row.verified_at || null,
    publishedAt: row.published_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function escapeCsvValue(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  rows.forEach(row => {
    lines.push(headers.map(header => escapeCsvValue(row[header])).join(','));
  });
  return lines.join('\n');
}

function buildStudentFullName(student) {
  const directName = student.full_name || student.fullName || student.name || '';
  if (directName) return directName;
  const first = student.first_name || student.firstName || '';
  const middle = student.middle_name || student.middleName || '';
  const last = student.last_name || student.lastName || '';
  return [first, middle, last].filter(Boolean).join(' ');
}

function normalizeHeaderKey(value = '') {
  return normalizeResultHeader(value);
}

function getRowValue(row = {}, aliases = []) {
  const keys = aliases.map(alias => normalizeHeaderKey(alias));
  const match = Object.entries(row || {}).find(([headerName]) => keys.includes(normalizeHeaderKey(headerName)));
  if (!match) return '';
  return String(match[1] ?? '').trim();
}

async function getAllStudents() {
  if (isDbConnected && connectionPool) {
    try {
      const result = await connectionPool.query('SELECT * FROM students ORDER BY created_at DESC');
      return getQueryRows(result);
    } catch (e) {
      console.error('Failed to fetch students for result operations:', e);
    }
  }
  return global.__students || [];
}

async function getAllResults() {
  if (isDbConnected && connectionPool) {
    try {
      const result = await connectionPool.query('SELECT * FROM student_results ORDER BY created_at DESC');
      const students = await getAllStudents();
      const classes = new Map((students || []).map(student => [String(student.reg_no || student.regNo || '').trim(), student.student_class || student.class || '']));
      return getQueryRows(result).map(row => serializeResultRecord(row, classes.get(String(row.reg_no || row.regNo || '').trim())));
    } catch (e) {
      console.error('Failed to fetch results from PostgreSQL DB:', e);
    }
  }
  return (global.__student_results || []).map(row => serializeResultRecord(row));
}

async function getResultByRegNo(regNo, studentClass = '') {
  const target = String(regNo || '').trim();
  if (!target) return null;

  if (isDbConnected && connectionPool) {
    try {
      const result = await connectionPool.query('SELECT * FROM student_results WHERE reg_no = $1 LIMIT 1', [target]);
      const rows = getQueryRows(result);
      if (rows && rows.length > 0) return serializeResultRecord(rows[0], studentClass);
    } catch (e) {
      console.error('Failed to fetch result by registration number:', e);
    }
  }

  const match = (global.__student_results || []).find(item => String(item.reg_no || item.regNo || '').trim() === target);
  return match ? serializeResultRecord(match, studentClass) : null;
}

async function createOrUpdateResultRecord(resultPayload) {
  if (isDbConnected && connectionPool) {
    try {
      const values = [
        resultPayload.regNo,
        resultPayload.studentName || '',
        Number(resultPayload.maths ?? 0),
        Number(resultPayload.english ?? 0),
        Number(resultPayload.evsScience ?? resultPayload.evs ?? 0),
        Number(resultPayload.totalMarks ?? 0),
        Number(resultPayload.marathi ?? 0),
        Number(resultPayload.maths ?? 0),
        Number(resultPayload.evsScience ?? resultPayload.evs ?? 0),
        Number(resultPayload.socialScience ?? 0),
        Number(resultPayload.logicalReasoning ?? 0),
        String(resultPayload.status || 'DRAFT').toUpperCase()
      ];

      await connectionPool.query(`
        INSERT INTO student_results (reg_no, student_name, mathematics, english, science, total_marks, marathi, maths, evs_science, social_science, logical_reasoning, percentage, result_status, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, '', $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (reg_no)
        DO UPDATE SET student_name = EXCLUDED.student_name,
                      mathematics = EXCLUDED.mathematics,
                      english = EXCLUDED.english,
                      science = EXCLUDED.science,
                      total_marks = EXCLUDED.total_marks,
                      marathi = EXCLUDED.marathi,
                      maths = EXCLUDED.maths,
                      evs_science = EXCLUDED.evs_science,
                      social_science = EXCLUDED.social_science,
                      logical_reasoning = EXCLUDED.logical_reasoning,
                      status = EXCLUDED.status,
                      updated_at = CURRENT_TIMESTAMP
      `, values);
    } catch (e) {
      console.error('Failed to upsert result in PostgreSQL DB:', e);
    }
  }

  const existingIndex = (global.__student_results || []).findIndex(item => String(item.reg_no || item.regNo || '').trim() === String(resultPayload.regNo || '').trim());
  const record = {
    reg_no: resultPayload.regNo,
    regNo: resultPayload.regNo,
    student_name: resultPayload.studentName || '',
    studentName: resultPayload.studentName || '',
    className: resultPayload.className || '',
    mathematics: Number(resultPayload.maths ?? 0),
    english: Number(resultPayload.english ?? 0),
    science: Number(resultPayload.evsScience ?? resultPayload.evs ?? 0),
    marathi: Number(resultPayload.marathi ?? 0),
    maths: Number(resultPayload.maths ?? 0),
    evs: Number(resultPayload.evs ?? 0),
    evsScience: Number(resultPayload.evsScience ?? 0),
    socialScience: Number(resultPayload.socialScience ?? 0),
    logicalReasoning: Number(resultPayload.logicalReasoning ?? 0),
    total_marks: Number(resultPayload.totalMarks ?? 0),
    status: String(resultPayload.status || 'DRAFT').toUpperCase(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (existingIndex >= 0) {
    global.__student_results[existingIndex] = record;
  } else {
    global.__student_results.push(record);
  }

  return serializeResultRecord(record);
}

async function updateResultStatusById(resultId, nextStatus) {
  const targetId = Number(resultId);

  if (isDbConnected && connectionPool) {
    try {
      await connectionPool.query(
        'UPDATE student_results SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [String(nextStatus).toUpperCase(), targetId]
      );
    } catch (e) {
      console.error('Failed to update result status in PostgreSQL DB:', e);
    }
  }

  const list = global.__student_results || [];
  const index = list.findIndex(item => Number(item.id || 0) === targetId);
  if (index >= 0) {
    list[index].status = String(nextStatus).toUpperCase();
    list[index].updated_at = new Date().toISOString();
  }

  return true;
}

async function updateResultStatusByRegNo(regNo, nextStatus) {
  const target = String(regNo || '').trim();

  if (isDbConnected && connectionPool) {
    try {
      await connectionPool.query(
        'UPDATE student_results SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE reg_no = $2',
        [String(nextStatus).toUpperCase(), target]
      );
    } catch (e) {
      console.error('Failed to update result status by registration number in PostgreSQL DB:', e);
    }
  }

  const list = global.__student_results || [];
  const index = list.findIndex(item => String(item.reg_no || item.regNo || '').trim() === target);
  if (index >= 0) {
    list[index].status = String(nextStatus).toUpperCase();
    list[index].updated_at = new Date().toISOString();
  }

  return true;
}

async function generateRegistrationPdfBuffer(student) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A5', margin: 24 });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const cardWidth = pageWidth;
      const leftX = doc.page.margins.left;

      doc.rect(leftX, 20, cardWidth, 90).fill('#0f2b5c');
      doc.fillColor('white').fontSize(16).font('Helvetica-Bold').text('IGNITED MINDS TALENT SEARCH EXAM', leftX + 16, 32, { width: cardWidth - 32, align: 'center' });
      doc.fontSize(10).font('Helvetica').text('2026-27 | MTDK Shaikshnik Sankul', leftX + 16, 58, { width: cardWidth - 32, align: 'center' });

      doc.moveDown(5);
      doc.fillColor('#1a1a2e').fontSize(12).font('Helvetica-Bold').text('Registration Details', leftX, 130);
      doc.moveTo(leftX, 145).lineTo(leftX + cardWidth, 145).stroke('#e2e8f0');

      const lines = [
        ['Registration No.', student.reg_no || student.regNo || ''],
        ['Student Name', student.full_name || student.fullName || ''],
        ['Class & Medium', `${student.student_class || student.class || ''} - ${student.medium || ''}`],
        ['School Name', student.school_name || student.schoolName || ''],
        ['Amount Paid', student.amount || ''],
        ['Payment Mode', student.pay_mode || student.payMode || ''],
        ['Date of Registration', formatDateWithDay(student.reg_date || student.regDate || '')],
        ['Exam Date', '14 February 2027'],
        ['Exam Time', '11:00 AM to 1:00 PM'],
        ['Exam Centre', 'MTDK School']
      ];

      const labelX = leftX + 12;
      const valueX = leftX + 140;
      let y = 160;

      lines.forEach(([label, val], index) => {
        if (index > 0 && index % 5 === 0) {
          y += 8;
        }
        doc.fillColor('#475569').fontSize(10).font('Helvetica-Bold').text(label, labelX, y, { lineBreak: false });
        doc.fillColor('#0f2b5c').fontSize(10).font('Helvetica').text(String(val || ''), valueX, y, { width: cardWidth - valueX - 12, lineBreak: false });
        y += 20;
      });

      const noteTop = y + 8;
      doc.roundedRect(leftX, noteTop, cardWidth, 88, 8).fill('#f8fafc');
      doc.fillColor('#334155').fontSize(10).font('Helvetica').text('Exam Date: 14 February 2027', leftX + 12, noteTop + 12);
      doc.text('Time: 11:00 AM to 1:00 PM', leftX + 12, noteTop + 28);
      doc.text('Exam Centre: MTDK School', leftX + 12, noteTop + 44);
      doc.fillColor('#475569').fontSize(9).text('Please carry this admit card along with a valid photo ID on exam day.', leftX + 12, noteTop + 60, { width: cardWidth - 24 });

      doc.fillColor('#64748b').fontSize(8).text('Initiative by MTDK Shaikshnik Sankul', leftX, doc.page.height - 36, { align: 'center', width: cardWidth });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function getPgSslSetting() {
  const sslValue = String(process.env.PGSSL || process.env.PGSSLMODE || process.env.SSL || '').toLowerCase();
  if (!sslValue) return false;
  return ['true', '1', 'require', 'verify-ca', 'verify-full'].includes(sslValue) ? { rejectUnauthorized: false } : false;
}

function buildPgConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: getPgSslSetting() || undefined
    };
  }

  const config = {
    host: process.env.PGHOST || process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
    user: process.env.PGUSER || process.env.DB_USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.PGDATABASE || process.env.DB_NAME || 'imtse_portal',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  };

  const ssl = getPgSslSetting();
  if (ssl) config.ssl = ssl;

  return config;
}

async function tryInitDatabase(providedPool = null) {
  if (providedPool) {
    connectionPool = providedPool;
    isDbConnected = true;
    dbInitError = null;
    return;
  }

  try {
    const config = buildPgConfig();
    const hasExplicitPgSettings = Boolean(process.env.DATABASE_URL || process.env.PGHOST || process.env.PGUSER || process.env.PGDATABASE || process.env.DB_HOST || process.env.DB_USER || process.env.DB_NAME);
    if (!hasExplicitPgSettings) {
      throw new Error('No PostgreSQL configuration found. Set DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.');
    }

    connectionPool = new Pool(config);
    if (typeof connectionPool.on === 'function') {
      connectionPool.on('error', (err) => {
        console.error('PostgreSQL pool error:', err && err.message ? err.message : err);
        isDbConnected = false;
        dbInitError = err;
      });
    }

    await connectionPool.query('SELECT 1');
    await connectionPool.query(`
      CREATE TABLE IF NOT EXISTS students (
        reg_no VARCHAR(50) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        student_class VARCHAR(20) NOT NULL,
        medium VARCHAR(50) NOT NULL,
        school_name VARCHAR(255) NOT NULL,
        dob DATE NOT NULL,
        parent_name VARCHAR(255) NOT NULL,
        whatsapp VARCHAR(20) NOT NULL,
        email VARCHAR(255) NULL,
        address TEXT NOT NULL,
        amount VARCHAR(50) NOT NULL,
        pay_mode VARCHAR(100) NOT NULL,
        payment_screenshot_name VARCHAR(255) NULL,
        payment_screenshot_data TEXT NULL,
        status VARCHAR(100) NOT NULL DEFAULT 'Pending Verification',
        reg_date DATE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (whatsapp),
        CONSTRAINT uniq_reg_no UNIQUE (reg_no)
      );
    `);

    try {
      await connectionPool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS payment_screenshot_name VARCHAR(255);`);
    } catch (e) {}
    try {
      await connectionPool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS payment_screenshot_data TEXT;`);
    } catch (e) {}
    try {
      await connectionPool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS email VARCHAR(255);`);
    } catch (e) {}

    await connectionPool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await connectionPool.query(`
      CREATE TABLE IF NOT EXISTS study_resources (
        id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        resource_type VARCHAR(20) NOT NULL,
        url VARCHAR(1000) NULL,
        description TEXT NULL,
        file_name VARCHAR(255) NULL,
        file_data TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await connectionPool.query(`
      CREATE TABLE IF NOT EXISTS student_results (
        id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        reg_no VARCHAR(50) NOT NULL UNIQUE,
        student_name VARCHAR(255) NOT NULL,
        mathematics INTEGER NULL,
        english INTEGER NULL,
        science INTEGER NULL,
        marathi INTEGER NULL,
        maths INTEGER NULL,
        evs_science INTEGER NULL,
        social_science INTEGER NULL,
        logical_reasoning INTEGER NULL,
        total_marks INTEGER NOT NULL DEFAULT 0,
        percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
        result_status VARCHAR(20) NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    for (const column of ['marathi', 'maths', 'evs_science', 'social_science', 'logical_reasoning']) {
      try {
        await connectionPool.query(`ALTER TABLE student_results ADD COLUMN IF NOT EXISTS ${column} INTEGER NULL;`);
      } catch (e) {}
    }

    await connectionPool.query(`
      INSERT INTO admin_users (username, password)
      VALUES ('admin', 'admin')
      ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password;
    `);

    isDbConnected = true;
    dbInitError = null;
    console.log('PostgreSQL database initialized successfully');
  } catch (err) {
    isDbConnected = false;
    dbInitError = err;
    connectionPool = null;
    console.error('PostgreSQL initialization failed:', err && err.message ? err.message : err);
    throw err;
  }
}

function createServer(options = {}) {
  const app = express();
  app.use(express.static(path.join(__dirname)));
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  if (options.emailTransporter) {
    setInjectedEmailTransporter(options.emailTransporter);
  }

  try {
    tryInitDatabase(options.pool || null);
  } catch (e) {
    console.error('Failed to initialize PostgreSQL database:', e && e.message ? e.message : e);
  }

  app.get('/api/health', async (_req, res) => {
    res.json({
      status: 'ok',
      dbConnected: isDbConnected,
      error: dbInitError ? String(dbInitError.message || dbInitError) : null,
      hallTicketUnlockDate: process.env.HALL_TICKET_UNLOCK_DATE || null
    });
  });

  /**
   * Hall Ticket Availability Endpoint
   * Check if Hall Ticket is available for download
   * Returns 403 if locked, 200 if available
   */
  app.get('/api/hall-ticket/status', async (_req, res) => {
    const isAvailable = hallTicketConfig.isHallTicketAvailable();
    const unlockDateDisplay = hallTicketConfig.getHallTicketUnlockDateDisplay();
    
    if (!isAvailable) {
      return res.status(403).json({
        success: false,
        available: false,
        message: `Hall Ticket will be available on ${unlockDateDisplay}`,
        unlockDate: unlockDateDisplay
      });
    }
    
    return res.status(200).json({
      success: true,
      available: true,
      message: 'Hall Ticket is available for download',
      unlockDate: unlockDateDisplay
    });
  });

  const allowInMemoryFallback = process.env.ALLOW_IN_MEMORY_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  app.get('/api/results/summary', async (_req, res) => {
    try {
      const students = await getAllStudents();
      const results = await getAllResults();
      const totalRegistered = (students || []).length;
      const resultsUploaded = (results || []).length;
      const resultsVerified = (results || []).filter(r => String(r.status || '').toUpperCase() === 'VERIFIED').length;
      const resultsPublished = (results || []).filter(r => String(r.status || '').toUpperCase() === 'PUBLISHED').length;
      const errorsPending = (results || []).filter(r => String(r.status || '').toUpperCase() === 'DRAFT').length;

      res.json({
        totalRegistered,
        resultsUploaded,
        resultsVerified,
        resultsPublished,
        errorsPending,
        success: true
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to calculate result summary', details: error.message || String(error) });
    }
  });

  app.get('/api/results/template', async (_req, res) => {
    const students = await getAllStudents();
    const rows = (students || []).map(student => {
      const fullName = String(buildStudentFullName(student) || '').trim();

      return {
        'Registration No': student.reg_no || student.regNo || '',
        'Student Name': fullName,
        'School Name': student.school_name || student.schoolName || '',
        'Standard': student.student_class || student.class || '',
        'Medium': student.medium || '',
        'Payment Mode': student.pay_mode || student.payMode || '',
        'Marathi': '',
        'English': '',
        'Maths': '',
        'EVS / Science': '',
        'Social Science': '',
        'Logical Reasoning': '',
        'Total': '',
      };
    });

    const csvPayload = rows.length > 0 ? rows : [{
      'Registration No': '',
      'Student Name': '',
      'School Name': '',
      'Standard': '',
      'Medium': '',
      'Payment Mode': '',
      'Marathi': '',
      'English': '',
      'Maths': '',
      'EVS / Science': '',
      'Social Science': '',
      'Logical Reasoning': '',
      'Total': '',
    }];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="result_template.csv"');
    res.send(toCsv(csvPayload));
  });

  app.get('/api/students/export', async (_req, res) => {
    try {
      const students = await getAllStudents();
      const rows = (students || []).map(student => {
        const fullName = String(buildStudentFullName(student) || '').trim();
        const names = fullName.split(/\s+/);
        const firstName = names[0] || '';
        const middleName = names.slice(1, -1).join(' ');
        const lastName = names.slice(-1)[0] || '';
        const mode = String(student.pay_mode || student.payMode || '').trim();
        const screenshot = /online|upi/i.test(mode) && (student.payment_screenshot_data || student.paymentScreenshotData) ? 'View Screenshot' : 'Not Required';

        return {
          'Registration No': student.reg_no || student.regNo || '',
          'First Name': firstName,
          'Middle Name': middleName,
          'Last Name': lastName,
          'School Name': student.school_name || student.schoolName || '',
          'Phone': student.whatsapp || '',
          'Email': student.email || '',
          'Gender': '',
          'Standard': student.student_class || student.class || '',
          'Medium': student.medium || '',
          'Payment Mode': mode,
          'Payment Screenshot': screenshot
        };
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="registered_students.csv"');
      res.send(toCsv(rows));
    } catch (error) {
      res.status(500).json({ error: 'Failed to export registered students', details: error.message || String(error) });
    }
  });

  app.post('/api/results/upload', async (req, res) => {
    try {
      const rawResults = Array.isArray(req.body && req.body.results) ? req.body.results : [];
      const students = await getAllStudents();
      const studentMap = new Map((students || []).map(student => [String(student.reg_no || student.regNo || '').trim(), student]));
      const seen = new Set();
      const validResults = [];
      const errors = [];

      for (let i = 0; i < rawResults.length; i += 1) {
        const row = rawResults[i] || {};
        const hasAnyData = Object.values(row).some(value => String(value ?? '').trim() !== '');
        if (!hasAnyData) continue;

        const regNo = getRowValue(row, ['registrationNo', 'regNo', 'reg_no', 'Registration No', 'Registration Number', 'Reg No', 'Reg. No']).trim();
        const uploadedSchoolName = String(getRowValue(row, ['schoolName', 'School Name']) || '').trim();
        const student = studentMap.get(regNo);

        if (!regNo) {
          errors.push({ row: i + 1, message: 'Registration number is required.' });
          continue;
        }

        if (!student) {
          errors.push({ row: i + 1, regNo, message: 'Registration number not found in database.' });
          continue;
        }

        const existingSchoolName = String(student.school_name || student.schoolName || '').trim();
        if (uploadedSchoolName && existingSchoolName && uploadedSchoolName.toLowerCase() !== existingSchoolName.toLowerCase()) {
          errors.push({ row: i + 1, regNo, message: 'School Name does not match the registered student.' });
          continue;
        }

        if (seen.has(regNo)) {
          errors.push({ row: i + 1, regNo, message: 'Duplicate registration number found in the uploaded file.' });
          continue;
        }
        seen.add(regNo);

        const studentClass = student.student_class || student.class || '';
        const subjects = getResultSubjects(studentClass);
        const marks = getResultMarksFromInput(row, studentClass);
        const missingSubjects = subjects.filter(subject => marks[subject.apiKey] === null).map(subject => subject.label);
        if (missingSubjects.length > 0) {
          errors.push({ row: i + 1, regNo, message: `Missing marks for: ${missingSubjects.join(', ')}` });
          continue;
        }

        const invalidSubjects = subjects.filter(subject => {
          const value = marks[subject.apiKey];
          return value === null || value < 0 || value > subject.maxMarks;
        }).map(subject => subject.label);
        if (invalidSubjects.length > 0) {
          errors.push({ row: i + 1, regNo, message: `Invalid marks for: ${invalidSubjects.join(', ')}` });
          continue;
        }

        const summary = calculateResultSummary(marks, studentClass);
        const resultRecord = {
          regNo,
          studentName: buildStudentFullName(student),
          schoolName: existingSchoolName,
          className: studentClass,
          ...marks,
          totalMarks: summary.totalMarks,
          status: 'DRAFT'
        };
        validResults.push(resultRecord);
      }

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Result upload contains validation errors. No invalid data was published.',
          validStudents: 0,
          errors,
          results: [],
          summary: { total: 0, pass: 0, fail: 0, uploaded: 0 }
        });
      }

      const stored = [];
      for (const result of validResults) {
        const record = await createOrUpdateResultRecord(result);
        stored.push(record);
      }

      const summary = {
        total: stored.reduce((sum, item) => sum + Number(item.totalMarks || 0), 0),
        uploaded: stored.length
      };

      return res.json({
        success: true,
        validStudents: stored.length,
        errors: [],
        results: stored,
        summary,
        message: 'Results validated successfully and saved as draft.'
      });
    } catch (error) {
      console.error('Failed to import results:', error);
      res.status(500).json({ error: 'Failed to upload results', details: error.message || String(error) });
    }
  });

  app.get('/api/results', async (_req, res) => {
    try {
      const results = await getAllResults();
      const students = await getAllStudents();
      const studentMap = new Map((students || []).map(student => [String(student.reg_no || student.regNo || '').trim(), student]));

      const formatted = (results || []).map(result => {
        const regNo = String(result.regNo || '').trim();
        const student = studentMap.get(regNo) || null;
        return {
          ...result,
          schoolName: result.schoolName || (student ? (student.school_name || student.schoolName || '') : ''),
          studentName: result.studentName || buildStudentFullName(student || {}),
          className: student ? (student.student_class || student.class || '') : '',
          medium: student ? (student.medium || '') : ''
        };
      });
      res.json(formatted);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch results', details: error.message || String(error) });
    }
  });

  app.post('/api/results/:resultId/verify', async (req, res) => {
    try {
      const param = String(req.params.resultId || '').trim();
      const resultId = Number(param);
      if (Number.isFinite(resultId)) {
        await updateResultStatusById(resultId, 'VERIFIED');
      } else {
        await updateResultStatusByRegNo(param, 'VERIFIED');
      }
      res.json({ success: true, message: 'Result verified successfully.' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to verify result', details: error.message || String(error) });
    }
  });

  app.post('/api/results/:resultId/publish', async (req, res) => {
    try {
      const param = String(req.params.resultId || '').trim();
      const resultId = Number(param);
      if (Number.isFinite(resultId)) {
        await updateResultStatusById(resultId, 'PUBLISHED');
      } else {
        await updateResultStatusByRegNo(param, 'PUBLISHED');
      }
      res.json({ success: true, message: 'Result published successfully.' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to publish result', details: error.message || String(error) });
    }
  });

  app.post('/api/results/:resultId/reopen', async (req, res) => {
    try {
      const param = String(req.params.resultId || '').trim();
      const resultId = Number(param);
      if (Number.isFinite(resultId)) {
        await updateResultStatusById(resultId, 'DRAFT');
      } else {
        await updateResultStatusByRegNo(param, 'DRAFT');
      }
      res.json({ success: true, message: 'Result reopened for correction.' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to reopen result', details: error.message || String(error) });
    }
  });

  app.get('/api/results/me', async (req, res) => {
    try {
      const regNo = String(req.query.regNo || '').trim();
      const dob = String(req.query.dob || '').trim();
      if (!regNo || !dob) return res.status(400).json({ error: 'Registration number and DOB are required.' });

      const students = await getAllStudents();
      const candidate = (students || []).find(student => {
        const storedDob = normalizeDate(student.dob || student.DOB || '');
        const requestDob = normalizeDate(dob || '');
        const storedRegNo = String(student.reg_no || student.regNo || '').trim();
        const inputRegNo = String(regNo || '').trim();
        return storedRegNo === inputRegNo && storedDob && requestDob && storedDob === requestDob;
      });

      if (!candidate) {
        return res.status(403).json({ success: false, message: 'Unauthorized access.' });
      }

      const candidateClass = candidate.student_class || candidate.class || '';
      const result = await getResultByRegNo(candidate.reg_no || candidate.regNo, candidateClass);
      if (!result) {
        return res.json({
          success: true,
          published: false,
          message: 'Result is not published yet.',
          student: {
            regNo: candidate.reg_no || candidate.regNo,
            name: buildStudentFullName(candidate),
            className: candidate.student_class || candidate.class,
            medium: candidate.medium,
            status: candidate.status
          },
          result: null
        });
      }

      if (String(result.status || '').toUpperCase() !== 'PUBLISHED') {
        return res.json({
          success: true,
          published: false,
          message: 'Result is not published yet.',
          student: {
            regNo: candidate.reg_no || candidate.regNo,
            name: buildStudentFullName(candidate),
            className: candidate.student_class || candidate.class,
            medium: candidate.medium,
            status: candidate.status
          },
          result: null
        });
      }

      const studentPayload = {
        regNo: candidate.reg_no || candidate.regNo,
        name: buildStudentFullName(candidate),
        className: candidate.student_class || candidate.class,
        medium: candidate.medium,
        status: candidate.status
      };

      return res.json({
        success: true,
        published: true,
        student: studentPayload,
        result: {
          regNo: result.regNo,
          studentName: result.studentName,
          className: candidateClass,
          marathi: result.marathi,
          english: result.english,
          maths: result.maths,
          evs: result.evs,
          evsScience: result.evsScience,
          socialScience: result.socialScience,
          logicalReasoning: result.logicalReasoning,
          totalMarks: result.totalMarks,
          status: result.status
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch student result', details: error.message || String(error) });
    }
  });

  app.get('/api/students', async (_req, res) => {
    if (isDbConnected && connectionPool) {
      try {
        const result = await connectionPool.query('SELECT * FROM students ORDER BY created_at DESC');
        const rows = getQueryRows(result);
        const formatted = (rows || []).map(r => {
          const row = { ...r };
          if (row.dob instanceof Date) row.dob = row.dob.toISOString().split('T')[0];
          else if (typeof row.dob === 'string' && row.dob.indexOf('T') !== -1) row.dob = row.dob.split('T')[0];
          if (row.reg_date instanceof Date) row.reg_date = row.reg_date.toISOString().split('T')[0];
          else if (typeof row.reg_date === 'string' && row.reg_date.indexOf('T') !== -1) row.reg_date = row.reg_date.split('T')[0];
          return row;
        });
        return res.json(formatted);
      } catch (error) {
        console.error('Failed to fetch students from PostgreSQL DB:', error);
        if (!allowInMemoryFallback) {
          return res.status(503).json({ error: 'Database unavailable', details: error.message || 'PostgreSQL query failed' });
        }
      }
    }
    if (!allowInMemoryFallback) {
      return res.status(503).json({ error: 'Database unavailable', details: dbInitError ? dbInitError.message : 'PostgreSQL connection failed' });
    }
    return res.json(global.__students);
  });

  app.get('/api/students/:studentId', async (req, res) => {
    const identifier = String(req.params.studentId || '').trim();
    if (isDbConnected && connectionPool) {
      try {
        const result = await connectionPool.query(
          `SELECT * FROM students WHERE reg_no = $1 OR whatsapp = $2 LIMIT 1`,
          [identifier, identifier]
        );
        const rows = getQueryRows(result);
        if (rows && rows.length > 0) {
          const r = { ...rows[0] };
          if (r.dob instanceof Date) r.dob = r.dob.toISOString().split('T')[0];
          else if (typeof r.dob === 'string' && r.dob.indexOf('T') !== -1) r.dob = r.dob.split('T')[0];
          if (r.reg_date instanceof Date) r.reg_date = r.reg_date.toISOString().split('T')[0];
          else if (typeof r.reg_date === 'string' && r.reg_date.indexOf('T') !== -1) r.reg_date = r.reg_date.split('T')[0];
          return res.json(r);
        }
      } catch (e) {
        console.error('Failed to fetch student by ID from PostgreSQL DB:', e);
        if (!allowInMemoryFallback) {
          return res.status(503).json({ error: 'Database unavailable', details: e.message || 'PostgreSQL query failed' });
        }
      }
    }
    if (!allowInMemoryFallback) {
      return res.status(503).json({ error: 'Database unavailable', details: dbInitError ? dbInitError.message : 'PostgreSQL connection failed' });
    }
    const student = global.__students.find(s => (s.regNo || s.reg_no) === identifier || s.whatsapp === identifier);
    if (student) return res.json(student);
    return res.status(404).json({ error: 'Student not found' });
  });

  app.post('/api/students', async (req, res) => {
    try {
      const student = req.body;
      const dobValue = normalizeDate(student.dob) || student.dob || '2015-01-01';
      const regDateValue = normalizeDate(student.regDate) || normalizeDate(new Date());
      const whatsapp = String(student.whatsapp || '').trim();
      if (!whatsapp) return res.status(400).json({ error: 'Mobile number is required' });
      if ((student.payMode || '').toString().toLowerCase().includes('upi') && !student.paymentScreenshotData) {
        return res.status(400).json({ error: 'Payment screenshot is required for UPI payments' });
      }

      if (isDbConnected && connectionPool) {
        try {
          const existing = await connectionPool.query('SELECT reg_no FROM students WHERE whatsapp = $1 LIMIT 1', [whatsapp]);
          const existingRows = getQueryRows(existing);
          if (existingRows && existingRows.length > 0) return res.status(409).json({ error: 'Mobile number already registered.' });

          await connectionPool.query(`
            INSERT INTO students (reg_no, full_name, student_class, medium, school_name, dob, parent_name, whatsapp, email, address, amount, pay_mode, payment_screenshot_name, payment_screenshot_data, status, reg_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          `, [
            student.regNo, student.fullName, student.class, student.medium, student.schoolName,
            dobValue, student.parentName, student.whatsapp, student.email || null,
            student.address, student.amount, student.payMode, student.paymentScreenshotName || null, student.paymentScreenshotData || null, student.status || 'Pending Verification', regDateValue
          ]);
          return res.status(201).json({ regNo: student.regNo, message: 'Student saved successfully' });
        } catch (dbErr) {
          if (dbErr && dbErr.code === '23505') {
            return res.status(409).json({ error: 'Mobile number already registered.' });
          }
          console.warn('DB save failed:', dbErr && dbErr.message ? dbErr.message : dbErr);
          if (!allowInMemoryFallback) {
            return res.status(503).json({ error: 'Database unavailable', details: dbErr && dbErr.message ? dbErr.message : 'PostgreSQL save failed' });
          }
        }
      }

      if (!allowInMemoryFallback) {
        return res.status(503).json({ error: 'Database unavailable', details: dbInitError ? dbInitError.message : 'PostgreSQL connection failed' });
      }

      const idx = global.__students.findIndex(s => s.whatsapp === whatsapp || (s.regNo && s.regNo === student.regNo));
      if (idx !== -1) global.__students[idx] = student;
      else global.__students.push(student);

      res.status(201).json({ regNo: student.regNo, message: 'Student saved successfully' });
    } catch (error) {
      console.error('Failed to save student', error);
      res.status(500).json({ error: 'Failed to save student', details: error.message });
    }
  });

  app.post('/api/students/:studentId/approve', async (req, res) => {
    const identifier = String(req.params.studentId || '').trim();
    console.log('[APPROVAL] API entered', { identifier, body: req.body || {} });

    try {
      let student = null;

      if (isDbConnected && connectionPool) {
        try {
          const result = await connectionPool.query(
            `SELECT * FROM students WHERE reg_no = $1 OR whatsapp = $2 LIMIT 1`,
            [identifier, identifier]
          );
          const rows = getQueryRows(result);
          if (rows && rows.length > 0) student = rows[0];

          await connectionPool.query(
            `UPDATE students SET status = 'Approved & Active (Fees Paid)' WHERE reg_no = $1 OR whatsapp = $2`,
            [identifier, identifier]
          );
        } catch (dbError) {
          console.error('[APPROVAL] Database update failed', dbError && dbError.message ? dbError.message : dbError);
          if (!allowInMemoryFallback) {
            return res.status(503).json({ error: 'Database unavailable', details: dbError.message || 'PostgreSQL update failed' });
          }
        }
      } else if (!allowInMemoryFallback) {
        return res.status(503).json({ error: 'Database unavailable', details: dbInitError ? dbInitError.message : 'PostgreSQL connection failed' });
      }

      const memStudent = global.__students.find(s => (s.regNo || s.reg_no) === identifier || s.whatsapp === identifier);
      if (memStudent) {
        memStudent.status = 'Approved & Active (Fees Paid)';
        if (!student) student = memStudent;
      }

      if (!student) return res.status(404).json({ error: 'Student not found' });

      console.log('[APPROVAL] Student object', student);
      console.log('[APPROVAL] Student email', student.email || student.studentEmail || student.emailAddress || null);

      let emailInfo = { ok: false };
      try {
        emailInfo = await sendApprovalEmail(student);
      } catch (emailErr) {
        const errorMessage = emailErr && emailErr.message ? emailErr.message : String(emailErr);
        console.error('[APPROVAL] Email send threw an exception', errorMessage);
        if (emailErr && emailErr.stack) console.error(emailErr.stack);
        emailInfo = { ok: false, reason: 'send-exception', error: errorMessage };
      }

      const responsePayload = {
        message: 'Student approved successfully',
        emailSent: !!emailInfo.ok,
        regNo: student.reg_no || student.regNo || identifier,
        reason: emailInfo.reason || null
      };
      if (emailInfo && emailInfo.previewUrl) responsePayload.previewUrl = emailInfo.previewUrl;
      if (emailInfo && emailInfo.error) responsePayload.emailError = emailInfo.error;
      console.log('[APPROVAL] Response returned to frontend', responsePayload);
      res.json(responsePayload);
    } catch (error) {
      console.error('[APPROVAL] Failed to approve student', error);
      res.status(500).json({ error: 'Failed to approve student', details: error.message });
    }
  });

  app.post('/api/students/:studentId/reject', async (req, res) => {
    try {
      const identifier = String(req.params.studentId || '').trim();
      if (isDbConnected && connectionPool) {
        try {
          await connectionPool.query(`UPDATE students SET status = 'Rejected' WHERE reg_no = $1 OR whatsapp = $2`, [identifier, identifier]);
        } catch (e) {
          console.error('Failed to update student rejection in PostgreSQL:', e);
          if (!allowInMemoryFallback) {
            return res.status(503).json({ error: 'Database unavailable', details: e.message || 'PostgreSQL update failed' });
          }
        }
      } else if (!allowInMemoryFallback) {
        return res.status(503).json({ error: 'Database unavailable', details: dbInitError ? dbInitError.message : 'PostgreSQL connection failed' });
      }
      const memStudent = global.__students.find(s => (s.regNo || s.reg_no) === identifier || s.whatsapp === identifier);
      if (memStudent) memStudent.status = 'Rejected';
      res.json({ message: 'Student rejected' });
    } catch (error) {
      console.error('Failed to reject student', error);
      res.status(500).json({ error: 'Failed to reject student' });
    }
  });

  app.put('/api/students/:studentId', async (req, res) => {
    try {
      const student = req.body;
      const identifier = String(req.params.studentId || '').trim();
      const dobValue = normalizeDate(student.dob) || student.dob;
      const regDateValue = normalizeDate(student.regDate) || normalizeDate(new Date());

      if (isDbConnected && connectionPool) {
        try {
          await connectionPool.query(`
            UPDATE students SET full_name=$1, student_class=$2, medium=$3, school_name=$4, dob=$5,
              parent_name=$6, whatsapp=$7, email=$8, address=$9, amount=$10, pay_mode=$11, status=$12, reg_date=$13
            WHERE reg_no = $14 OR whatsapp = $15
          `, [
            student.fullName, student.class, student.medium, student.schoolName, dobValue,
            student.parentName, student.whatsapp, student.email || null, student.address,
            student.amount, student.payMode, student.status || 'Pending Verification', regDateValue,
            identifier, identifier
          ]);
          return res.json({ regNo: student.regNo || identifier, message: 'Student updated successfully' });
        } catch (e) {
          console.error('Failed to update student in PostgreSQL:', e);
          if (!allowInMemoryFallback) {
            return res.status(503).json({ error: 'Database unavailable', details: e.message || 'PostgreSQL update failed' });
          }
        }
      }

      if (!allowInMemoryFallback) {
        return res.status(503).json({ error: 'Database unavailable', details: dbInitError ? dbInitError.message : 'PostgreSQL connection failed' });
      }

      const idx = global.__students.findIndex(s => (s.regNo || s.reg_no) === identifier || s.whatsapp === identifier);
      if (idx !== -1) global.__students[idx] = { ...global.__students[idx], ...student };

      res.json({ regNo: student.regNo || identifier, message: 'Student updated successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update student' });
    }
  });

  app.delete('/api/students/:studentId', async (req, res) => {
    try {
      const identifier = String(req.params.studentId || '').trim();
      if (isDbConnected && connectionPool) {
        try {
          await connectionPool.query('DELETE FROM students WHERE reg_no = $1 OR whatsapp = $2', [identifier, identifier]);
          return res.json({ regNo: identifier, message: 'Student deleted successfully' });
        } catch (e) {
          console.error('Failed to delete student in PostgreSQL:', e);
          if (!allowInMemoryFallback) {
            return res.status(503).json({ error: 'Database unavailable', details: e.message || 'PostgreSQL delete failed' });
          }
        }
      }

      if (!allowInMemoryFallback) {
        return res.status(503).json({ error: 'Database unavailable', details: dbInitError ? dbInitError.message : 'PostgreSQL connection failed' });
      }

      global.__students = global.__students.filter(s => (s.regNo || s.reg_no) !== identifier && s.whatsapp !== identifier);
      res.json({ regNo: identifier, message: 'Student deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete student' });
    }
  });

  app.get('/api/resources', async (_req, res) => {
    if (isDbConnected && connectionPool) {
      try {
        const result = await connectionPool.query(`SELECT * FROM study_resources ORDER BY created_at DESC`);
        const rows = getQueryRows(result);
        return res.json((rows || []).map(r => ({
          id: r.id, title: r.title, category: r.category, type: r.resource_type,
          url: r.url, description: r.description, fileName: r.file_name, fileData: r.file_data, createdAt: r.created_at
        })));
      } catch (e) {
        console.error('Failed to fetch resources from PostgreSQL DB:', e);
        if (!allowInMemoryFallback) {
          return res.status(503).json({ error: 'Database unavailable', details: e.message || 'PostgreSQL query failed' });
        }
      }
    }
    if (!allowInMemoryFallback) {
      return res.status(503).json({ error: 'Database unavailable', details: dbInitError ? dbInitError.message : 'PostgreSQL connection failed' });
    }
    res.json(global.__resources);
  });

  app.post('/api/resources', async (req, res) => {
    const resource = req.body;
    resource.id = resource.id || Date.now();
    if (isDbConnected && connectionPool) {
      try {
        const result = await connectionPool.query(
          `INSERT INTO study_resources (title, category, resource_type, url, description, file_name, file_data) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [resource.title, resource.category, resource.type, resource.url || '', resource.description || '', resource.fileName || '', resource.fileData || '']
        );
        const rows = getQueryRows(result);
        if (rows && rows[0] && rows[0].id) resource.id = rows[0].id;
        return res.status(201).json({ id: resource.id, message: 'Resource saved successfully' });
      } catch (e) {
        console.error('Failed to save resource in PostgreSQL:', e);
        if (!allowInMemoryFallback) {
          return res.status(503).json({ error: 'Database unavailable', details: e.message || 'PostgreSQL insert failed' });
        }
      }
    }
    if (!allowInMemoryFallback) {
      return res.status(503).json({ error: 'Database unavailable', details: dbInitError ? dbInitError.message : 'PostgreSQL connection failed' });
    }
    global.__resources.push(resource);
    res.status(201).json({ id: resource.id, message: 'Resource saved successfully' });
  });

  app.put('/api/resources/:id', async (req, res) => {
    const resourceId = Number(req.params.id);
    const resource = req.body;
    if (isDbConnected && connectionPool) {
      try {
        await connectionPool.query(
          `UPDATE study_resources SET title=$1, category=$2, resource_type=$3, url=$4, description=$5, file_name=$6, file_data=$7 WHERE id=$8`,
          [resource.title, resource.category, resource.type, resource.url || '', resource.description || '', resource.fileName || '', resource.fileData || '', resourceId]
        );
        return res.json({ id: resourceId, message: 'Resource updated successfully' });
      } catch (e) {
        console.error('Failed to update resource in PostgreSQL:', e);
        if (!allowInMemoryFallback) {
          return res.status(503).json({ error: 'Database unavailable', details: e.message || 'PostgreSQL update failed' });
        }
      }
    }
    if (!allowInMemoryFallback) {
      return res.status(503).json({ error: 'Database unavailable', details: dbInitError ? dbInitError.message : 'PostgreSQL connection failed' });
    }
    const idx = global.__resources.findIndex(r => r.id === resourceId);
    if (idx !== -1) global.__resources[idx] = { ...global.__resources[idx], ...resource };
    res.json({ id: resourceId, message: 'Resource updated successfully' });
  });

  app.delete('/api/resources/:id', async (req, res) => {
    const resourceId = Number(req.params.id);
    if (isDbConnected && connectionPool) {
      try {
        await connectionPool.query(`DELETE FROM study_resources WHERE id = $1`, [resourceId]);
        return res.json({ id: resourceId, message: 'Resource deleted successfully' });
      } catch (e) {
        console.error('Failed to delete resource in PostgreSQL:', e);
        if (!allowInMemoryFallback) {
          return res.status(503).json({ error: 'Database unavailable', details: e.message || 'PostgreSQL delete failed' });
        }
      }
    }
    if (!allowInMemoryFallback) {
      return res.status(503).json({ error: 'Database unavailable', details: dbInitError ? dbInitError.message : 'PostgreSQL connection failed' });
    }
    global.__resources = global.__resources.filter(r => r.id !== resourceId);
    res.json({ id: resourceId, message: 'Resource deleted successfully' });
  });

  return app;
}

if (require.main === module) {
  const app = createServer();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`IMTSE API listening on port ${port}`);
  });
}

module.exports = { createServer };
