const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');
const PDFDocument = require('pdfkit');
const axios = require('axios');
const XLSX = require('xlsx');
const { SUBJECT_GROUPS, normalizeResultHeader, getGroupForClass } = require('./result-subjects.js');

// Load Hall Ticket configuration
const hallTicketConfig = require('./hallTicketConfig.js');

dotenv.config({ path: path.join(__dirname, '.env') });

// In-memory fallbacks
if (!global.__students) global.__students = [];
if (!global.__resources) global.__resources = [];
if (!global.__student_results) global.__student_results = [];
if (!global.__email_queue) global.__email_queue = [];
if (!global.__student_sessions) global.__student_sessions = new Map();
if (!global.__release_controls) global.__release_controls = { hallTicketReleased: false, resultReleased: false };

const RESULT_FORMATS = {
  junior: SUBJECT_GROUPS.PRIMARY,
  senior: SUBJECT_GROUPS.SECONDARY
};

const MAX_RESULT_TOTAL = 200;
const FIXED_HALL_TICKET_EXAM_CENTER = 'Matoshree Tanubai Dagadu Khade English School and Junior College, Sainandan Colony, Near Rama Udyan, Miraj';

let connectionPool = null;
let isDbConnected = false;
let dbInitError = null;
let injectedEmailTransporter = null;

function getReleaseState() {
  return {
    hallTicketReleased: Boolean(global.__release_controls.hallTicketReleased),
    resultReleased: Boolean(global.__release_controls.resultReleased)
  };
}

async function readReleaseState() {
  if (isDbConnected && connectionPool) {
    try {
      const result = await connectionPool.query('SELECT hall_ticket_released, result_released FROM release_controls WHERE id = 1 LIMIT 1');
      const row = getQueryRows(result)[0];
      if (row) {
        global.__release_controls = {
          hallTicketReleased: Boolean(row.hall_ticket_released),
          resultReleased: Boolean(row.result_released)
        };
      }
    } catch (error) {
      console.error('Failed to read release controls:', error.message || error);
    }
  }
  return getReleaseState();
}

async function updateReleaseState(changes) {
  const currentState = await readReleaseState();
  const nextState = { ...currentState, ...changes };
  global.__release_controls = nextState;
  if (isDbConnected && connectionPool) {
    await connectionPool.query(`
      INSERT INTO release_controls (id, hall_ticket_released, result_released, updated_at)
      VALUES (1, $1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET hall_ticket_released = EXCLUDED.hall_ticket_released,
                                      result_released = EXCLUDED.result_released,
                                      updated_at = CURRENT_TIMESTAMP
    `, [nextState.hallTicketReleased, nextState.resultReleased]);
  }
  return nextState;
}

async function requireAdminReleaseAccess(req, res, next) {
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Admin authentication is required.' });
  }

  let username = '';
  let password = '';
  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    username = separator >= 0 ? decoded.slice(0, separator) : '';
    password = separator >= 0 ? decoded.slice(separator + 1) : '';
  } catch (error) {}

  let valid = username === (process.env.ADMIN_USERNAME || 'MTDK') && password === (process.env.ADMIN_PASSWORD || 'MTDK@123');
  if (!valid && isDbConnected && connectionPool) {
    try {
      const result = await connectionPool.query('SELECT id FROM admin_users WHERE username = $1 AND password = $2 LIMIT 1', [username, password]);
      valid = getQueryRows(result).length > 0;
    } catch (error) {}
  }
  if (!valid) return res.status(403).json({ error: 'Admin authentication failed.' });
  return next();
}

function getStudentSessionToken(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  const sessionCookie = cookies.find(cookie => cookie.trim().startsWith('student_session='));
  return sessionCookie ? decodeURIComponent(sessionCookie.trim().slice('student_session='.length)) : '';
}

function requireStudentSession(req, res, next) {
  const token = getStudentSessionToken(req);
  const session = token ? global.__student_sessions.get(token) : null;
  if (!session) return res.status(401).json({ error: 'Student authentication is required.' });
  req.studentSession = session;
  next();
}

function createStudentSession(student) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    regNo: String(student.reg_no || student.regNo || '').trim(),
    dob: normalizeDate(student.dob || student.DOB || ''),
    studentId: student.id || null
  };
  global.__student_sessions.set(token, session);
  return { token, session };
}

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

const MANUAL_REGISTRATION_HEADERS = [
  'Sr. No.',
  'Name of the Student',
  'Std.',
  'Date of Birth',
  'Medium',
  'School & School Address',
  'Mob. No.',
  'Email ID',
  'Payment Mode'
];

function normalizeManualHeader(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function getManualField(row = {}, aliases = [], fallbackKeys = []) {
  const normalized = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    const cleaned = normalizeManualHeader(key);
    normalized[cleaned] = value;
    normalized[cleaned.toLowerCase()] = value;
    normalized[cleaned.replace(/[\s.&/()-]+/g, '').toLowerCase()] = value;
    const camelCase = cleaned.replace(/[\s.&/()-]+(.)/g, (_, char) => char.toUpperCase());
    normalized[camelCase] = value;
    normalized[camelCase.toLowerCase()] = value;
  });
  const candidates = [...aliases, ...fallbackKeys].flatMap(alias => {
    const clean = normalizeManualHeader(alias || '');
    const camelCase = clean.replace(/[\s.&/()-]+(.)/g, (_, char) => char.toUpperCase());
    return [
      clean,
      clean.toLowerCase(),
      clean.replace(/[\s.&/()-]+/g, '').toLowerCase(),
      camelCase,
      camelCase.toLowerCase()
    ];
  });

  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) {
      return normalized[key] ?? '';
    }
    if (row && Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key] ?? '';
    }
  }
  return '';
}

function safeNormalizeMob(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function safeNormalizeName(value = '') {
  return String(value || '').trim();
}

async function generateUniqueRegistrationNumber() {
  const existing = await getAllStudents();
  const used = new Set((existing || []).map(student => String(student.reg_no || student.regNo || '').trim()).filter(Boolean));
  let candidate = 10000;
  while (candidate <= 99999) {
    const regNo = `IMTSE-${candidate}`;
    if (!used.has(regNo)) return regNo;
    candidate += 1;
  }
  throw new Error('Unable to generate a unique registration number.');
}

async function initializeEmailQueueTable() {
  if (!isDbConnected || !connectionPool) return;
  try {
    await connectionPool.query(`
      CREATE TABLE IF NOT EXISTS email_queue (
        id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        student_id VARCHAR(100) NOT NULL,
        registration_number VARCHAR(50) NOT NULL,
        student_name VARCHAR(255) NOT NULL,
        email_address VARCHAR(255) NOT NULL,
        registration_type VARCHAR(30) NOT NULL DEFAULT 'Online',
        email_type VARCHAR(50) NOT NULL DEFAULT 'REGISTRATION',
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at TIMESTAMP NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NULL
      );
    `);
  } catch (error) {
    console.error('Failed to initialize email queue table:', error && error.message ? error.message : error);
  }
}

async function addEmailQueueEntry(entry) {
  const record = {
    studentId: String(entry.studentId || ''),
    registrationNumber: String(entry.registrationNumber || ''),
    studentName: String(entry.studentName || ''),
    emailAddress: String(entry.emailAddress || ''),
    registrationType: String(entry.registrationType || 'Online'),
    emailType: String(entry.emailType || 'REGISTRATION'),
    status: String(entry.status || 'PENDING').toUpperCase(),
    retryCount: Number(entry.retryCount || 0),
    lastError: entry.lastError ? String(entry.lastError).slice(0, 1000) : null
  };

  if (!record.studentId || !record.registrationNumber || !record.emailAddress) {
    return null;
  }

  if (isDbConnected && connectionPool) {
    try {
      const result = await connectionPool.query(
        `INSERT INTO email_queue (student_id, registration_number, student_name, email_address, registration_type, email_type, status, retry_count, last_error, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
         RETURNING id, status, created_at`,
        [record.studentId, record.registrationNumber, record.studentName, record.emailAddress, record.registrationType, record.emailType, record.status, record.retryCount, record.lastError]
      );
      const row = getQueryRows(result)[0];
      return row ? { id: row.id, status: row.status, createdAt: row.created_at } : null;
    } catch (error) {
      console.error('Failed to create email queue entry:', error && error.message ? error.message : error);
      return null;
    }
  }

  const createdAt = new Date().toISOString();
  const queuedRecord = {
    id: Date.now(),
    student_id: record.studentId,
    registration_number: record.registrationNumber,
    student_name: record.studentName,
    email_address: record.emailAddress,
    registration_type: record.registrationType,
    email_type: record.emailType,
    status: record.status,
    created_at: createdAt,
    retry_count: record.retryCount,
    last_error: record.lastError
  };
  global.__email_queue.push(queuedRecord);
  return { id: queuedRecord.id, status: queuedRecord.status, createdAt };
}

async function updateEmailQueueStatus(studentId, registrationNumber, status, options = {}) {
  const nextStatus = String(status || 'PENDING').toUpperCase();
  const errorText = options.lastError ? String(options.lastError).slice(0, 1000) : null;
  const retryCount = Number(options.retryCount || 0);

  if (isDbConnected && connectionPool) {
    try {
      await connectionPool.query(
        `UPDATE email_queue
         SET status = $1,
             sent_at = CASE WHEN $1 = 'SENT' THEN CURRENT_TIMESTAMP ELSE sent_at END,
             retry_count = $2,
             last_error = $3
         WHERE student_id = $4 AND registration_number = $5`,
        [nextStatus, retryCount, errorText, String(studentId), String(registrationNumber)]
      );
    } catch (error) {
      console.error('Failed to update email queue status:', error && error.message ? error.message : error);
    }
  }

  if (!isDbConnected || !connectionPool) {
    global.__email_queue
      .filter(entry => entry.student_id === String(studentId) && entry.registration_number === String(registrationNumber))
      .forEach(entry => {
        entry.status = nextStatus;
        entry.retry_count = retryCount;
        entry.last_error = errorText;
      });
  }

  return { status: nextStatus };
}

async function getEmailSummary() {
  if (isDbConnected && connectionPool) {
    try {
      const result = await connectionPool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'SENT') AS sent,
          COUNT(*) FILTER (WHERE status IN ('PENDING', 'WAITING')) AS waiting,
          COUNT(*) FILTER (WHERE status = 'FAILED') AS failed
        FROM email_queue
      `);
      const row = getQueryRows(result)[0] || {};
      return {
        sent: Number(row.sent || 0),
        waiting: Number(row.waiting || 0),
        failed: Number(row.failed || 0)
      };
    } catch (error) {
      console.error('Failed to fetch email summary:', error && error.message ? error.message : error);
    }
  }
  return {
    sent: global.__email_queue.filter(entry => entry.status === 'SENT').length,
    waiting: global.__email_queue.filter(entry => ['PENDING', 'WAITING'].includes(entry.status)).length,
    failed: global.__email_queue.filter(entry => entry.status === 'FAILED').length
  };
}

async function getWaitingEmailRows() {
  if (isDbConnected && connectionPool) {
    try {
      const result = await connectionPool.query(
        `SELECT student_name, registration_number, email_address, registration_type, status, created_at
         FROM email_queue
         WHERE status IN ('PENDING', 'WAITING')
         ORDER BY created_at DESC`);
      return getQueryRows(result);
    } catch (error) {
      console.error('Failed to fetch waiting emails:', error && error.message ? error.message : error);
    }
  }
  return global.__email_queue.filter(entry => ['PENDING', 'WAITING'].includes(entry.status));
}

async function queueRegistrationEmail(student, registrationType = 'Manual') {
  const studentEmail = student.email || student.studentEmail || student.emailAddress;
  const studentName = student.full_name || student.fullName || student.name || 'Student';
  const registrationNumber = student.reg_no || student.regNo || student.regno || '';

  if (!studentEmail || !registrationNumber) {
    return { ok: false, reason: 'no-email-or-reg-no' };
  }

  await addEmailQueueEntry({
    studentId: student.reg_no || student.regNo || student.whatsapp || registrationNumber,
    registrationNumber,
    studentName,
    emailAddress: studentEmail,
    registrationType: String(registrationType || 'Manual'),
    emailType: 'REGISTRATION',
    status: 'PENDING'
  });

  const emailInfo = await sendApprovalEmail(student);
  if (emailInfo && emailInfo.ok) {
    await updateEmailQueueStatus(student.reg_no || student.regNo || student.whatsapp || registrationNumber, registrationNumber, 'SENT', { retryCount: 0, lastError: null });
    return { ok: true, status: 'SENT', reason: null };
  }

  const errorText = emailInfo && emailInfo.error ? String(emailInfo.error) : 'unknown';
  const shouldWait = /limit|429|quota|rate limit|daily|too many/i.test(errorText) || /limit|429|quota|rate limit|daily|too many/i.test(String(emailInfo && emailInfo.reason || ''));
  const nextStatus = shouldWait ? 'WAITING' : 'FAILED';
  await updateEmailQueueStatus(student.reg_no || student.regNo || student.whatsapp || registrationNumber, registrationNumber, nextStatus, { retryCount: 1, lastError: errorText });
  return { ok: false, status: nextStatus, reason: emailInfo && emailInfo.reason ? emailInfo.reason : 'send-failed', error: errorText };
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
        Exam Centre: <strong>Sainandan Colony, Near Rama Udyan, Matoshree Tanubai Dagadu Khade English School and Junior College, Miraj</strong><br>
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
  const toIsoDate = (year, month, day) => {
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() + 1 !== Number(month) || parsed.getUTCDate() !== Number(day)) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  if (value instanceof Date) {
    const yyyy = value.getFullYear();
    return toIsoDate(yyyy, value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const excelDate = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
    return toIsoDate(excelDate.getUTCFullYear(), excelDate.getUTCMonth() + 1, excelDate.getUTCDate());
  }

  const asString = String(value).trim();
  if (!asString) return null;

  const isoMatch = asString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return toIsoDate(isoMatch[1], isoMatch[2], isoMatch[3]);

  const tIndex = asString.indexOf('T');
  let candidate = asString;
  if (tIndex !== -1) candidate = asString.substring(0, tIndex);
  if (candidate.indexOf(' ') !== -1) candidate = candidate.split(' ')[0];
  const isoLike = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoLike) return toIsoDate(isoLike[1], isoLike[2], isoLike[3]);

  const dmMatch = asString.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (dmMatch) return toIsoDate(dmMatch[3], dmMatch[2], dmMatch[1]);

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
    if (month && day >= 1 && day <= 31) return toIsoDate(year, month, day);
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
  const normalized = String(value || '').trim().toUpperCase().replace(/[.]/g, '');
  const romanClasses = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  const numericMatch = normalized.match(/^(?:(?:CLASS|STD)\s*)?(10|[1-9])(?:ST|ND|RD|TH)?$/);
  if (numericMatch) return Number(numericMatch[1]);
  const romanValue = normalized.replace(/^(?:CLASS|STD)\s*/, '');
  return romanClasses[romanValue] || null;
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
      match = entries.find(([header, value]) => normalizeResultHeader(header) === 'evsScience' && hasValue(value));
    }
    if (!match && subject.field === 'evsScience' && group === 'SECONDARY') {
      match = entries.find(([header, value]) => normalizeResultHeader(header) === 'evs' && hasValue(value));
    }
    if (!match && subject.field === 'mathsLogicalReasoning' && group === 'SECONDARY') {
      const mathsMatch = entries.find(([header, value]) => normalizeResultHeader(header) === 'maths' && hasValue(value));
      const logicalMatch = entries.find(([header, value]) => normalizeResultHeader(header) === 'logicalReasoning' && hasValue(value));
      const maths = toNumber(mathsMatch ? mathsMatch[1] : undefined);
      const logical = toNumber(logicalMatch ? logicalMatch[1] : undefined);
      if (maths !== null || logical !== null) {
        marks[subject.apiKey] = Number((maths ?? 0) + (logical ?? 0));
        return;
      }
    }
    const parsed = toNumber(match ? match[1] : undefined);
    marks[subject.apiKey] = parsed;
  });
  return marks;
}

function getRawResultMark(rawMarks = {}, subject, group) {
  const entries = Object.entries(rawMarks || {});
  const aliases = group === 'PRIMARY' && subject.field === 'evs'
    ? ['evs', 'evsScience']
    : group === 'SECONDARY' && subject.field === 'evsScience'
      ? ['evsScience', 'evs']
      : group === 'SECONDARY' && subject.field === 'mathsLogicalReasoning'
        ? ['mathsLogicalReasoning', 'maths', 'logicalReasoning']
        : [subject.field];

  const matchingEntries = entries.filter(([header]) => aliases.includes(normalizeResultHeader(header)));
  const populatedMatch = matchingEntries.find(([, value]) => String(value ?? '').trim() !== '');
  const matchingValues = matchingEntries.map(([, value]) => value);

  if (subject.field === 'mathsLogicalReasoning' && matchingValues.length > 0) {
    const numbers = matchingValues
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && String(value ?? '').trim() !== '');
    if (numbers.length > 0) return String(numbers.reduce((sum, value) => sum + value, 0));
    return populatedMatch ? String(populatedMatch[1] ?? '').trim() : String(matchingValues[0] ?? '').trim();
  }

  if (populatedMatch) return String(populatedMatch[1] ?? '').trim();
  const match = matchingEntries[0];
  return match ? String(match[1] ?? '').trim() : '';
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
    const databaseColumn = {
      marathi: 'marathi',
      english: 'english',
      maths: 'maths',
      mathsLogicalReasoning: 'maths_logical_reasoning',
      evs: 'evs_science',
      evsScience: 'evs_science',
      socialScience: 'social_science',
      logicalReasoning: 'logical_reasoning'
    }[subject.apiKey];
    const legacyValue = subject.apiKey === 'maths' ? row.mathematics : subject.apiKey === 'evs' || subject.apiKey === 'evsScience' ? row.science : undefined;
    const storedValue = row[subject.apiKey] ?? row[databaseColumn] ?? legacyValue ?? (
      subject.apiKey === 'mathsLogicalReasoning'
        ? (row.maths ?? row.logicalReasoning ?? row.logical_reasoning ?? undefined)
        : undefined
    );
    subjectMarks[subject.apiKey] = toNumber(storedValue);
  });
  const combinedMathsMarks = subjectMarks.mathsLogicalReasoning ?? toNumber(
    row.mathsLogicalReasoning ?? row.maths_logical_reasoning ?? row.maths ?? row.logicalReasoning ?? row.logical_reasoning
  );
  const status = String(row.status || 'DRAFT').toUpperCase();

  return {
    id: row.id,
    regNo: row.reg_no || row.regNo,
    studentName: row.student_name || row.studentName || '',
    className: resolvedClass,
    resultGroup: row.result_group || row.resultGroup || getGroupForClass(resolvedClass),
    ...subjectMarks,
    mathsLogicalReasoning: combinedMathsMarks,
    maths: combinedMathsMarks,
    logicalReasoning: combinedMathsMarks,
    totalMarks: Number(row.total_marks ?? 0),
    status,
    verifiedAt: row.verified_at || null,
    publishedAt: row.published_at || null,
    resultReleasedAt: row.result_released_at || row.resultReleasedAt || null,
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
      const rows = getQueryRows(result);
      const merged = [...rows];
      for (const student of global.__students || []) {
        const regNo = String(student.reg_no || student.regNo || '').trim();
        const mobile = String(student.whatsapp || student.mobile || '').trim();
        const exists = merged.some(row => String(row.reg_no || row.regNo || '').trim() === regNo || String(row.whatsapp || row.mobile || '').trim() === mobile);
        if (!exists) merged.push(student);
      }
      return merged;
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
  const combinedMathsMarks = Number(
    resultPayload.mathsLogicalReasoning ?? (
      Number.isFinite(Number(resultPayload.maths)) && Number.isFinite(Number(resultPayload.logicalReasoning))
        ? Number(resultPayload.maths) + Number(resultPayload.logicalReasoning)
        : (resultPayload.maths ?? resultPayload.logicalReasoning ?? 0)
    )
  );

  if (isDbConnected && connectionPool) {
    try {
      const values = [
        resultPayload.regNo,
        resultPayload.studentName || '',
        Number(resultPayload.mathsLogicalReasoning ?? resultPayload.maths ?? 0),
        Number(resultPayload.english ?? 0),
        Number(resultPayload.evsScience ?? resultPayload.evs ?? 0),
        Number(resultPayload.totalMarks ?? 0),
        Number(resultPayload.marathi ?? 0),
        combinedMathsMarks,
        Number(resultPayload.evsScience ?? resultPayload.evs ?? 0),
        Number(resultPayload.socialScience ?? 0),
        combinedMathsMarks,
        String(resultPayload.resultGroup || getGroupForClass(resultPayload.className || '')).toUpperCase(),
        String(resultPayload.status || 'DRAFT').toUpperCase()
      ];

      await connectionPool.query(`
        INSERT INTO student_results (reg_no, student_name, mathematics, english, science, total_marks, marathi, maths, evs_science, social_science, logical_reasoning, result_group, percentage, result_status, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, '', $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
                      result_group = EXCLUDED.result_group,
                      status = EXCLUDED.status,
                      updated_at = CURRENT_TIMESTAMP
      `, values);
    } catch (e) {
      console.error('Failed to upsert result in PostgreSQL DB:', e);
      throw e;
    }
  }

  const existingIndex = (global.__student_results || []).findIndex(item => String(item.reg_no || item.regNo || '').trim() === String(resultPayload.regNo || '').trim());
  const record = {
    reg_no: resultPayload.regNo,
    regNo: resultPayload.regNo,
    student_name: resultPayload.studentName || '',
    studentName: resultPayload.studentName || '',
    className: resultPayload.className || '',
    mathematics: combinedMathsMarks,
    english: Number(resultPayload.english ?? 0),
    science: Number(resultPayload.evsScience ?? resultPayload.evs ?? 0),
    marathi: Number(resultPayload.marathi ?? 0),
    maths: combinedMathsMarks,
    evs: Number(resultPayload.evs ?? 0),
    evsScience: Number(resultPayload.evsScience ?? 0),
    socialScience: Number(resultPayload.socialScience ?? 0),
    logicalReasoning: combinedMathsMarks,
    mathsLogicalReasoning: combinedMathsMarks,
    result_group: String(resultPayload.resultGroup || getGroupForClass(resultPayload.className || '')).toUpperCase(),
    resultGroup: String(resultPayload.resultGroup || getGroupForClass(resultPayload.className || '')).toUpperCase(),
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
        ['Exam Centre', 'Sainandan Colony, Near Rama Udyan, Matoshree Tanubai Dagadu Khade English School and Junior College, Miraj']
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
      doc.text('Exam Centre: Sainandan Colony, Near Rama Udyan, Matoshree Tanubai Dagadu Khade English School and Junior College, Miraj', leftX + 12, noteTop + 44);
      doc.fillColor('#475569').fontSize(9).text('Please carry this admit card along with a valid photo ID on exam day.', leftX + 12, noteTop + 60, { width: cardWidth - 24 });

      doc.fillColor('#64748b').fontSize(8).text('Initiative by MTDK Shaikshnik Sankul', leftX, doc.page.height - 36, { align: 'center', width: cardWidth });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function generateCertificatePdfBuffer(student, result = null) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const fullName = buildStudentFullName(student);
      const regNo = student.reg_no || student.regNo || '';
      const schoolName = student.school_name || student.schoolName || '';
      const studentClass = student.student_class || student.class || '';
      const totalMarks = result ? Number(result.totalMarks || result.total_marks || 0) : null;

      doc.rect(28, 28, doc.page.width - 56, doc.page.height - 56).lineWidth(2).stroke('#0f2b5c');
      doc.fillColor('#0f2b5c').font('Helvetica-Bold').fontSize(24).text('CERTIFICATE OF PARTICIPATION', 60, 110, { align: 'center' });
      doc.fillColor('#475569').font('Helvetica').fontSize(12).text('IGNITED MINDS TALENT SEARCH EXAM 2026-27', 60, 150, { align: 'center' });
      doc.fillColor('#1a1a2e').fontSize(17).text('This is to certify that', 60, 225, { align: 'center' });
      doc.fillColor('#0f2b5c').font('Helvetica-Bold').fontSize(28).text(fullName, 60, 265, { align: 'center' });
      doc.fillColor('#334155').font('Helvetica').fontSize(15).text('has participated in the Ignited Minds Talent Search Examination.', 60, 325, { align: 'center' });

      const details = [
        ['Registration Number', regNo],
        ['School', schoolName],
        ['Standard', studentClass],
        ['Medium', student.medium || '']
      ];
      if (totalMarks !== null) details.push(['Result Total', `${totalMarks}/200`]);
      let y = 405;
      details.forEach(([label, value]) => {
        doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(11).text(label, 105, y);
        doc.fillColor('#0f2b5c').font('Helvetica').fontSize(12).text(String(value || ''), 260, y);
        y += 28;
      });
      doc.fillColor('#64748b').fontSize(10).text('Issued by MTDK Shaikshnik Sankul', 60, doc.page.height - 105, { align: 'center' });
      doc.end();
    } catch (error) {
      reject(error);
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
    await initializeEmailQueueTable();
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
        result_group VARCHAR(20) NOT NULL DEFAULT 'SECONDARY',
          result_released_at TIMESTAMP NULL,
        total_marks INTEGER NOT NULL DEFAULT 0,
        percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
        result_status VARCHAR(20) NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await connectionPool.query(`
      CREATE TABLE IF NOT EXISTS release_controls (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        hall_ticket_released BOOLEAN NOT NULL DEFAULT FALSE,
        result_released BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await connectionPool.query(`
      INSERT INTO release_controls (id) VALUES (1)
      ON CONFLICT (id) DO NOTHING;
    `);

    await connectionPool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS hall_ticket_released_at TIMESTAMP NULL;`);
    await connectionPool.query(`ALTER TABLE student_results ADD COLUMN IF NOT EXISTS result_released_at TIMESTAMP NULL;`);
    await connectionPool.query(`
      UPDATE students
      SET hall_ticket_released_at = controls.updated_at
      FROM release_controls controls
      WHERE controls.id = 1
        AND controls.hall_ticket_released = TRUE
        AND students.hall_ticket_released_at IS NULL
        AND students.created_at <= controls.updated_at;
    `);
    await connectionPool.query(`
      UPDATE student_results
      SET result_released_at = controls.updated_at
      FROM release_controls controls
      WHERE controls.id = 1
        AND controls.result_released = TRUE
        AND student_results.result_released_at IS NULL
        AND student_results.status = 'PUBLISHED'
        AND student_results.created_at <= controls.updated_at;
    `);

    for (const column of ['marathi', 'maths', 'evs_science', 'social_science', 'logical_reasoning']) {
      try {
        await connectionPool.query(`ALTER TABLE student_results ADD COLUMN IF NOT EXISTS ${column} INTEGER NULL;`);
      } catch (e) {}
    }
    try {
      await connectionPool.query(`ALTER TABLE student_results ADD COLUMN IF NOT EXISTS result_group VARCHAR(20) NOT NULL DEFAULT 'SECONDARY';`);
    } catch (e) {}

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

  app.post('/api/student/login', async (req, res) => {
    try {
      const mobile = safeNormalizeMob(req.body && (req.body.mobile || req.body.whatsapp || req.body.phone));
      const dob = normalizeDate(req.body && req.body.dob);
      if (!mobile || !dob) return res.status(400).json({ error: 'Mobile number and DOB are required.' });

      const students = await getAllStudents();
      const student = (students || []).find(candidate => {
        const candidateMobile = safeNormalizeMob(candidate.whatsapp || candidate.mobile || '');
        const candidateDob = normalizeDate(candidate.dob || candidate.DOB || '');
        return candidateMobile === mobile && candidateDob === dob;
      });
      if (!student) return res.status(401).json({ error: 'Invalid mobile number or DOB.' });

      const { token, session } = createStudentSession(student);
      res.setHeader('Set-Cookie', 'student_session=' + encodeURIComponent(token) + '; HttpOnly; SameSite=Lax; Path=/');
      return res.json({
        success: true,
        student: {
          fullName: buildStudentFullName(student),
          class: student.student_class || student.class || '',
          medium: student.medium || '',
          schoolName: student.school_name || student.schoolName || '',
          dob: normalizeDate(student.dob || student.DOB || ''),
          parentName: student.parent_name || student.parentName || '',
          whatsapp: student.whatsapp || student.mobile || '',
          address: student.address || '',
          amount: student.amount || '',
          payMode: student.pay_mode || student.payMode || '',
          regNo: student.reg_no || student.regNo || '',
          status: student.status || '',
          regDate: student.reg_date || student.regDate || ''
        }
      });
    } catch (error) {
      return res.status(500).json({ error: 'Student login failed.', details: error.message || String(error) });
    }
  });

  app.post('/api/student/logout', requireStudentSession, (req, res) => {
    const token = getStudentSessionToken(req);
    global.__student_sessions.delete(token);
    res.setHeader('Set-Cookie', 'student_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ success: true });
  });

  app.get('/api/admin/release-status', requireAdminReleaseAccess, async (_req, res) => {
    res.json(await readReleaseState());
  });

  app.get('/api/admin/email-status', requireAdminReleaseAccess, async (_req, res) => {
    try {
      const summary = await getEmailSummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch email status', details: error.message || String(error) });
    }
  });

  app.get('/api/admin/email/waiting', requireAdminReleaseAccess, async (_req, res) => {
    try {
      const rows = await getWaitingEmailRows();
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch waiting emails', details: error.message || String(error) });
    }
  });

  async function validateManualRegistrationRows(rawRows = []) {
    const rows = Array.isArray(rawRows) ? rawRows : [];
    const errors = [];
    const preview = [];
    const seen = new Set();
    const firstDataRow = rows.find(row => Object.values(row || {}).some(value => String(value ?? '').trim() !== ''));
    if (firstDataRow) {
      const normalizedHeaders = new Set(Object.keys(firstDataRow).map(key => normalizeManualHeader(key).replace(/[\s.&/()-]+/g, '').toLowerCase()));
      const requiredHeaderGroups = [
        { label: 'Sr. No.', keys: ['srno', 'sno', 'serialno'] },
        { label: 'Name of the Student', keys: ['nameofthestudent', 'studentname', 'name'] },
        { label: 'Std.', keys: ['std', 'class', 'standard'] },
        { label: 'Date of Birth', keys: ['dateofbirth', 'dob'] },
        { label: 'Medium', keys: ['medium'] },
        { label: 'School & School Address', keys: ['schoolschooladdress', 'schoolname', 'schooladdress', 'school'] },
        { label: 'Mob. No.', keys: ['mobno', 'mobileno', 'mobilenumber', 'phone', 'whatsapp', 'mobile'] },
        { label: 'Email ID', keys: ['emailid', 'email'] },
        { label: 'Payment Mode', keys: ['paymentmode', 'modeofpayment', 'paymode'] }
      ];
      const missingHeaders = requiredHeaderGroups
        .filter(group => !group.keys.some(key => normalizedHeaders.has(key)))
        .map(group => group.label);
      if (missingHeaders.length > 0) {
        return {
          preview: [],
          errors: [{ row: 1, message: `Missing required columns: ${missingHeaders.join(', ')}` }],
          validRecords: 0,
          invalidRecords: 0,
          totalRecords: 0
        };
      }
    }
    const students = await getAllStudents();
    const mobileIndex = new Map((students || []).map(student => [safeNormalizeMob(student.whatsapp || student.mobile || '').replace(/^0+/, ''), true]));
    const emailIndex = new Map((students || []).map(student => [String(student.email || '').trim().toLowerCase(), true]));

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      const hasAnyData = Object.values(row).some(value => String(value ?? '').trim() !== '');
      if (!hasAnyData) continue;

      const serial = getManualField(row, ['Sr. No.', 'Sr No', 'S. No.'], ['serialNo']);
      const name = safeNormalizeName(getManualField(row, ['Name of the Student', 'Student Name'], ['name']));
      const standard = String(getManualField(row, ['Std.', 'Std', 'Class'], ['standard']) || '').trim();
      const dobValue = getManualField(row, ['Date of Birth', 'DOB'], ['dob', 'dateOfBirth']);
      const dob = dobValue instanceof Date || typeof dobValue === 'number' ? dobValue : String(dobValue || '').trim();
      const medium = String(getManualField(row, ['Medium'], ['medium']) || '').trim();
      const school = String(getManualField(row, ['School & School Address', 'School Name', 'School & Address'], ['school', 'schoolName']) || '').trim();
      const mobile = safeNormalizeMob(getManualField(row, ['Mob. No.', 'Mob No', 'Mobile No', 'Mobile Number', 'Phone'], ['mobile', 'phone', 'whatsapp']));
      const email = String(getManualField(row, ['Email ID', 'Email'], ['email', 'emailId']) || '').trim().toLowerCase();
      const paymentMode = String(getManualField(row, ['Payment Mode', 'Mode of Payment'], ['paymentMode', 'payMode']) || '').trim();

      const rowErrors = [];
      if (!name) rowErrors.push('Missing student name');
      if (!standard || !getClassNumber(standard)) rowErrors.push('Invalid Standard');
      const normalizedDob = normalizeDate(dob);
      if (!String(dob || '').trim()) rowErrors.push('Missing DOB');
      else if (!normalizedDob) rowErrors.push('Invalid DOB');
      else {
        const parsedDate = new Date(`${normalizedDob}T00:00:00`);
        if (Number.isNaN(parsedDate.getTime())) rowErrors.push('Invalid DOB');
      }
      if (!medium) rowErrors.push('Missing Medium');
      if (!school) rowErrors.push('Missing School');
      if (!mobile || mobile.length !== 10) rowErrors.push('Invalid mobile number');
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrors.push('Invalid email format');
      if (!paymentMode) rowErrors.push('Missing Payment Mode');

      const duplicateKey = `${(name || '').toLowerCase()}|${(normalizedDob || '').toLowerCase()}|${(mobile || '').slice(-10)}|${(school || '').toLowerCase()}`;
      if (seen.has(duplicateKey)) rowErrors.push('Duplicate record');
      else seen.add(duplicateKey);

      if (mobile && mobileIndex.has(mobile.replace(/^0+/, ''))) rowErrors.push('Duplicate mobile number already exists');
      if (email && emailIndex.has(email)) rowErrors.push('Duplicate email already exists');

      const record = {
        serialNo: serial,
        name,
        standard,
        dob: normalizedDob || dob,
        medium,
        school,
        mobile,
        email,
        paymentMode,
        status: rowErrors.length === 0 ? 'Ready' : rowErrors.join('; '),
        validationStatus: rowErrors.length === 0 ? 'Ready' : rowErrors.join('; '),
        rowNumber: index + 1
      };

      preview.push(record);
      if (rowErrors.length > 0) {
        errors.push({ row: index + 1, message: rowErrors.join('; '), data: record });
      }
    }

    return {
      preview,
      errors,
      validRecords: preview.filter(record => record.status === 'Ready').length,
      invalidRecords: preview.filter(record => record.status !== 'Ready').length,
      totalRecords: preview.length
    };
  }

  app.post('/api/admin/manual-registration/preview', requireAdminReleaseAccess, async (req, res) => {
    try {
      const rawRows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
      const validation = await validateManualRegistrationRows(rawRows);
      if (validation.validRecords === 0) {
        return res.status(400).json({
          success: false,
          message: 'Manual registration Excel contains no valid records.',
          validRecords: 0,
          invalidRecords: validation.invalidRecords,
          totalRecords: validation.totalRecords,
          errors: validation.errors,
          preview: validation.preview
        });
      }
      return res.json({
        success: true,
        totalRecords: validation.totalRecords,
        validRecords: validation.validRecords,
        invalidRecords: validation.invalidRecords,
        preview: validation.preview,
        errors: validation.errors
      });
    } catch (error) {
      res.status(500).json({ error: 'Manual registration preview failed', details: error.message || String(error) });
    }
  });

  app.post('/api/admin/manual-registration/import', requireAdminReleaseAccess, async (req, res) => {
    try {
      const rawRows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
      const validation = await validateManualRegistrationRows(rawRows);
      const validRows = validation.preview.filter(record => record.status === 'Ready');
      if (validRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid manual registration rows were available for import.',
          validRecords: 0,
          invalidRecords: validation.invalidRecords,
          errors: validation.errors
        });
      }

      const imported = [];
      const skipped = [];
      let sentCount = 0;
      let waitingCount = 0;
      let failedCount = 0;

      for (const row of validRows) {
        const regNo = await generateUniqueRegistrationNumber();
        const studentPayload = {
          fullName: String(row.name || '').toUpperCase(),
          class: String(row.standard || '').trim(),
          medium: String(row.medium || '').trim(),
          schoolName: String(row.school || '').toUpperCase(),
          dob: normalizeDate(row.dob) || String(row.dob || '').trim(),
          parentName: 'School Record',
          whatsapp: String(row.mobile || '').trim(),
          email: String(row.email || '').trim().toLowerCase(),
          address: `School: ${String(row.school || '').trim()}`,
          amount: '₹0.00',
          payMode: String(row.paymentMode || '').trim(),
          regNo,
          status: 'Approved & Active (Fees Paid)',
          regDate: new Date().toISOString().slice(0, 10)
        };

        try {
          if (isDbConnected && connectionPool) {
            const existing = await connectionPool.query('SELECT reg_no FROM students WHERE whatsapp = $1 LIMIT 1', [studentPayload.whatsapp]);
            if (getQueryRows(existing).length > 0) {
              skipped.push({ row: row.rowNumber, regNo, message: 'Duplicate mobile number already exists.' });
              continue;
            }
            await connectionPool.query(`
              INSERT INTO students (reg_no, full_name, student_class, medium, school_name, dob, parent_name, whatsapp, email, address, amount, pay_mode, status, reg_date)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            `, [
              regNo, studentPayload.fullName, studentPayload.class, studentPayload.medium, studentPayload.schoolName,
              normalizeDate(studentPayload.dob) || studentPayload.dob,
              studentPayload.parentName, studentPayload.whatsapp, studentPayload.email, studentPayload.address,
              studentPayload.amount, studentPayload.payMode, studentPayload.status, studentPayload.regDate
            ]);

            const memoryRecord = {
              regNo,
              reg_no: regNo,
              full_name: studentPayload.fullName,
              fullName: studentPayload.fullName,
              student_class: studentPayload.class,
              class: studentPayload.class,
              medium: studentPayload.medium,
              school_name: studentPayload.schoolName,
              schoolName: studentPayload.schoolName,
              dob: normalizeDate(studentPayload.dob) || studentPayload.dob,
              parent_name: studentPayload.parentName,
              parentName: studentPayload.parentName,
              whatsapp: studentPayload.whatsapp,
              email: studentPayload.email,
              address: studentPayload.address,
              amount: studentPayload.amount,
              pay_mode: studentPayload.payMode,
              payMode: studentPayload.payMode,
              status: studentPayload.status,
              reg_date: studentPayload.regDate,
              regDate: studentPayload.regDate
            };
            const existingMemoryIndex = (global.__students || []).findIndex(student => {
              const memoryReg = String(student.regNo || student.reg_no || '').trim();
              const memoryWhatsApp = String(student.whatsapp || '').trim();
              return (memoryReg && memoryReg === String(regNo || '').trim()) || (memoryWhatsApp && memoryWhatsApp === String(studentPayload.whatsapp || '').trim());
            });
            if (existingMemoryIndex >= 0) {
              global.__students[existingMemoryIndex] = { ...global.__students[existingMemoryIndex], ...memoryRecord };
            } else {
              global.__students.push(memoryRecord);
            }
          }

          if (!isDbConnected || !connectionPool) {
            const memoryRecord = {
              regNo,
              reg_no: regNo,
              full_name: studentPayload.fullName,
              fullName: studentPayload.fullName,
              student_class: studentPayload.class,
              class: studentPayload.class,
              medium: studentPayload.medium,
              school_name: studentPayload.schoolName,
              schoolName: studentPayload.schoolName,
              dob: normalizeDate(studentPayload.dob) || studentPayload.dob,
              parent_name: studentPayload.parentName,
              parentName: studentPayload.parentName,
              whatsapp: studentPayload.whatsapp,
              email: studentPayload.email,
              address: studentPayload.address,
              amount: studentPayload.amount,
              pay_mode: studentPayload.payMode,
              payMode: studentPayload.payMode,
              status: studentPayload.status,
              reg_date: studentPayload.regDate,
              regDate: studentPayload.regDate
            };
            const existingMemoryIndex = (global.__students || []).findIndex(student => {
              const memoryReg = String(student.regNo || student.reg_no || '').trim();
              const memoryWhatsApp = String(student.whatsapp || '').trim();
              return (memoryReg && memoryReg === String(regNo || '').trim()) || (memoryWhatsApp && memoryWhatsApp === String(studentPayload.whatsapp || '').trim());
            });
            if (existingMemoryIndex >= 0) {
              global.__students[existingMemoryIndex] = { ...global.__students[existingMemoryIndex], ...memoryRecord };
            } else {
              global.__students.push(memoryRecord);
            }
          }

          try {
            const emailResult = await queueRegistrationEmail(studentPayload, 'Manual');
            if (emailResult && emailResult.status === 'SENT') sentCount += 1;
            if (emailResult && emailResult.status === 'WAITING') waitingCount += 1;
            if (emailResult && emailResult.status === 'FAILED') failedCount += 1;
          } catch (emailError) {
            console.error('Manual registration email queue failed:', emailError && emailError.message ? emailError.message : emailError);
            failedCount += 1;
          }

          imported.push({ regNo, name: studentPayload.fullName, mobile: studentPayload.whatsapp, email: studentPayload.email, status: 'Imported' });
        } catch (error) {
          skipped.push({ row: row.rowNumber, regNo, message: error && error.message ? error.message : 'Import failed.' });
        }
      }

      const summary = {
        totalRecords: rawRows.length,
        imported: imported.length,
        duplicate: skipped.filter(item => /duplicate/i.test(item.message || '')).length,
        invalid: validation.invalidRecords,
        emailSent: sentCount,
        emailWaiting: waitingCount,
        emailFailed: failedCount
      };

      res.json({
        success: true,
        totalRecords: rawRows.length,
        imported: imported.length,
        duplicate: summary.duplicate,
        invalid: validation.invalidRecords,
        emailSent: sentCount,
        emailWaiting: waitingCount,
        emailFailed: failedCount,
        students: imported,
        skipped,
        summary
      });
    } catch (error) {
      res.status(500).json({ error: 'Manual registration import failed', details: error.message || String(error) });
    }
  });

  app.post('/api/admin/release/hall-ticket', requireAdminReleaseAccess, async (_req, res) => {
    try {
      const state = await updateReleaseState({ hallTicketReleased: true });
      if (isDbConnected && connectionPool) {
        await connectionPool.query(`
          UPDATE students
          SET hall_ticket_released_at = CURRENT_TIMESTAMP
          WHERE LOWER(status) LIKE '%approved%'
             OR LOWER(status) LIKE '%active%'
        `);
      }
      (global.__students || []).forEach(student => {
        const status = String(student.status || '').toLowerCase();
        if (status.includes('approved') || status.includes('active')) {
          student.hallTicketReleasedAt = new Date().toISOString();
        }
      });
      res.json({ success: true, ...state, message: 'Hall Tickets have been released successfully.' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to release Hall Tickets', details: error.message || String(error) });
    }
  });

  app.post('/api/admin/release/result', requireAdminReleaseAccess, async (_req, res) => {
    try {
      let results = await getAllResults();
      const memoryResults = global.__student_results || [];
      if (memoryResults.length > 0 && results.length === 0) {
        results = memoryResults.map(result => serializeResultRecord(result, result.className || result.standard || ''));
      }
      const unverified = results.filter(result => String(result.status || '').toUpperCase() === 'DRAFT');
      if (unverified.length > 0) {
        return res.status(409).json({ error: 'All results must be verified before release.', unverifiedCount: unverified.length });
      }

      if (isDbConnected && connectionPool) {
        await connectionPool.query("UPDATE student_results SET status = 'PUBLISHED', updated_at = CURRENT_TIMESTAMP WHERE status = 'VERIFIED'");
        await connectionPool.query("UPDATE student_results SET result_released_at = CURRENT_TIMESTAMP WHERE status = 'PUBLISHED' AND result_released_at IS NULL");
      }
      (global.__student_results || []).forEach(result => {
        if (String(result.status || '').toUpperCase() === 'VERIFIED') {
          result.status = 'PUBLISHED';
          result.updated_at = new Date().toISOString();
        }
        if (String(result.status || '').toUpperCase() === 'PUBLISHED' && !result.resultReleasedAt) {
          result.resultReleasedAt = new Date().toISOString();
        }
      });

      const state = await updateReleaseState({ resultReleased: true });
      res.json({ success: true, ...state, message: 'Results have been released successfully to all students.' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to release results', details: error.message || String(error) });
    }
  });

  app.get('/api/hall-ticket/status', async (_req, res) => {
    const releaseState = await readReleaseState();
    const isAvailable = hallTicketConfig.isHallTicketAvailable();
    const unlockDateDisplay = hallTicketConfig.getHallTicketUnlockDateDisplay();

    if (!releaseState.hallTicketReleased || !isAvailable) {
      return res.status(403).json({
        success: false,
        available: false,
        message: releaseState.hallTicketReleased ? `Hall Ticket will be available on ${unlockDateDisplay}` : 'Hall Ticket has not been released yet.',
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

  app.get('/api/hall-ticket', requireStudentSession, async (req, res) => {
    try {
      const regNo = String(req.query.regNo || '').trim();
      const dob = String(req.query.dob || '').trim();
      if (!regNo || !dob) return res.status(400).json({ error: 'Registration number and DOB are required.' });
      if (regNo !== req.studentSession.regNo || normalizeDate(dob) !== req.studentSession.dob) {
        return res.status(403).json({ error: 'Unauthorized access.' });
      }

      const students = await getAllStudents();
      const candidate = (students || []).find(student => {
        return String(student.reg_no || student.regNo || '').trim() === regNo
          && normalizeDate(student.dob || student.DOB || '') === normalizeDate(dob);
      });
      if (!candidate) return res.status(403).json({ error: 'Unauthorized access.' });

      const status = String(candidate.status || '').toLowerCase();
      if (!status.includes('approved') && !status.includes('active')) {
        return res.status(403).json({ error: 'Hall Ticket is available only to approved students.' });
      }

      const releaseState = await readReleaseState();
      if (!releaseState.hallTicketReleased || (!candidate.hall_ticket_released_at && !candidate.hallTicketReleasedAt)) {
        return res.status(403).json({ available: false, error: 'Hall Ticket has not been released yet.' });
      }
      if (!hallTicketConfig.isHallTicketAvailable()) {
        return res.status(403).json({ available: false, error: `Hall Ticket will be available on ${hallTicketConfig.getHallTicketUnlockDateDisplay()}.` });
      }

      return res.json({
        available: true,
        examCenter: FIXED_HALL_TICKET_EXAM_CENTER,
        student: {
          regNo: candidate.reg_no || candidate.regNo,
          fullName: buildStudentFullName(candidate),
          class: candidate.student_class || candidate.class || '',
          medium: candidate.medium || '',
          schoolName: candidate.school_name || candidate.schoolName || '',
          dob: normalizeDate(candidate.dob || candidate.DOB || '')
        }
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to authorize Hall Ticket access.', details: error.message || String(error) });
    }
  });

  app.get('/api/certificate', requireStudentSession, async (req, res) => {
    try {
      const regNo = String(req.query.regNo || '').trim();
      const dob = String(req.query.dob || '').trim();
      if (!regNo || !dob) return res.status(400).json({ error: 'Registration number and DOB are required.' });
      if (regNo !== req.studentSession.regNo || normalizeDate(dob) !== req.studentSession.dob) {
        return res.status(403).json({ error: 'Unauthorized access.' });
      }

      const students = await getAllStudents();
      const candidate = (students || []).find(student => {
        return String(student.reg_no || student.regNo || '').trim() === regNo
          && normalizeDate(student.dob || student.DOB || '') === normalizeDate(dob);
      });
      if (!candidate) return res.status(403).json({ error: 'Unauthorized access.' });

      const status = String(candidate.status || '').toLowerCase();
      if (!status.includes('approved') && !status.includes('active')) {
        return res.status(403).json({ error: 'Certificate is available only to approved students.' });
      }

      const result = await getResultByRegNo(regNo, candidate.student_class || candidate.class || '');
      const pdfBuffer = await generateCertificatePdfBuffer(candidate, result && String(result.status || '').toUpperCase() === 'PUBLISHED' ? result : null);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="IMTSE_Certificate_${regNo}.pdf"`);
      return res.send(pdfBuffer);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to generate certificate.', details: error.message || String(error) });
    }
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

  function buildResultTemplateRows(students, group) {
    const subjects = SUBJECT_GROUPS[group];
    const subjectHeaders = subjects.map(subject => subject.label);
    return (students || []).filter(student => getGroupForClass(student.student_class || student.class || '') === group).map(student => {
      const row = {
        'Registration No': student.reg_no || student.regNo || '',
        'Student Name': buildStudentFullName(student),
        'School Name': student.school_name || student.schoolName || '',
        'Standard': student.student_class || student.class || '',
        'Medium': student.medium || '',
        'Payment Mode': student.pay_mode || student.payMode || ''
      };
      subjectHeaders.forEach(header => { row[header] = ''; });
      row.Total = '';
      return row;
    });
  }

  async function sendResultTemplate(res, group) {
    const subjects = SUBJECT_GROUPS[group];
    const students = await getAllStudents();
    const rows = buildResultTemplateRows(students, group);
    const headers = [
      'Registration No', 'Student Name', 'School Name', 'Standard', 'Medium', 'Payment Mode',
      ...subjects.map(subject => subject.label), 'Total'
    ];
    const emptyRow = {
      'Registration No': '', 'Student Name': '', 'School Name': '', Standard: '', Medium: '', 'Payment Mode': ''
    };
    subjects.forEach(subject => { emptyRow[subject.label] = ''; });
    emptyRow.Total = '';
    const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [emptyRow], { header: headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');
    const workbookBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const filename = group === 'PRIMARY' ? 'result_template_classes_1_to_4.xlsx' : 'result_template_classes_5_to_10.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(workbookBuffer);
  }

  app.get('/api/results/template/primary', async (_req, res) => sendResultTemplate(res, 'PRIMARY'));
  app.get('/api/results/template/secondary', async (_req, res) => sendResultTemplate(res, 'SECONDARY'));
  app.get('/api/results/template', async (_req, res) => sendResultTemplate(res, 'SECONDARY'));

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

  async function handleResultsUpload(req, res, expectedGroup = null) {
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
        const actualGroup = getGroupForClass(studentClass);
        if (expectedGroup && actualGroup !== expectedGroup) {
          errors.push({ row: i + 1, regNo, message: `Student does not belong to ${expectedGroup === 'PRIMARY' ? 'Classes 1–4' : 'Classes 5–10'} group.` });
          continue;
        }
        const subjects = getResultSubjects(studentClass);
        const marks = getResultMarksFromInput(row, studentClass);
        const group = getGroupForClass(studentClass);
        const missingSubjects = subjects
          .filter(subject => getRawResultMark(row, subject, group) === '')
          .map(subject => subject.label);
        if (missingSubjects.length > 0) {
          errors.push({ row: i + 1, regNo, message: `Missing marks for: ${missingSubjects.join(', ')}` });
          continue;
        }

        const invalidSubjects = subjects.filter(subject => {
          const rawValue = getRawResultMark(row, subject, group);
          const value = Number(rawValue);
          return !Number.isFinite(value) || value < 0 || value > subject.maxMarks;
        }).map(subject => `${subject.label}="${getRawResultMark(row, subject, group)}"`);
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
          resultGroup: actualGroup,
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
  }

  app.post('/api/results/upload', requireAdminReleaseAccess, (req, res) => handleResultsUpload(req, res));
  app.post('/api/results/upload/primary', requireAdminReleaseAccess, (req, res) => handleResultsUpload(req, res, 'PRIMARY'));
  app.post('/api/results/upload/secondary', requireAdminReleaseAccess, (req, res) => handleResultsUpload(req, res, 'SECONDARY'));

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

  app.post('/api/results/:resultId/verify', requireAdminReleaseAccess, async (req, res) => {
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

  app.post('/api/results/:resultId/publish', requireAdminReleaseAccess, async (req, res) => {
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

  app.post('/api/results/publish-all', requireAdminReleaseAccess, async (_req, res) => {
    try {
      let published = 0;
      if (isDbConnected && connectionPool) {
        const result = await connectionPool.query(
          "UPDATE student_results SET status = 'PUBLISHED', updated_at = CURRENT_TIMESTAMP WHERE status = 'VERIFIED'"
        );
        published = Number(result.rowCount || 0);
      }
      let memoryPublished = 0;
      (global.__student_results || []).forEach(item => {
        if (String(item.status || '').toUpperCase() === 'VERIFIED') {
          item.status = 'PUBLISHED';
          item.updated_at = new Date().toISOString();
          memoryPublished += 1;
        }
      });
      if (!isDbConnected || published === 0) published = memoryPublished;
      res.json({ success: true, published, message: 'All verified results published successfully.' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to publish all results', details: error.message || String(error) });
    }
  });

  app.post('/api/results/:resultId/reopen', requireAdminReleaseAccess, async (req, res) => {
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

  app.get('/api/results/me', requireStudentSession, async (req, res) => {
    try {
      const regNo = String(req.query.regNo || '').trim();
      const dob = String(req.query.dob || '').trim();
      if ((regNo && regNo !== req.studentSession.regNo) || (dob && normalizeDate(dob) !== req.studentSession.dob)) {
        return res.status(403).json({ success: false, message: 'Unauthorized access.' });
      }

      const students = await getAllStudents();
      const candidate = (students || []).find(student => {
        const storedRegNo = String(student.reg_no || student.regNo || '').trim();
        return storedRegNo === req.studentSession.regNo;
      });

      if (!candidate) {
        return res.status(403).json({ success: false, message: 'Unauthorized access.' });
      }

      const releaseState = await readReleaseState();
      if (!releaseState.resultReleased) {
        return res.json({
          success: true,
          published: false,
          message: 'Result is not released yet.',
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

      if (!result.resultReleasedAt && !result.result_released_at) {
        return res.json({
          success: true,
          published: false,
          message: 'Result is not released yet.',
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
          mathsLogicalReasoning: result.mathsLogicalReasoning ?? result.maths ?? result.logicalReasoning,
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
        const mergedRows = [...(Array.isArray(rows) ? rows : [])];
        for (const student of (global.__students || [])) {
          const regNo = String(student.regNo || student.reg_no || '').trim();
          const whatsapp = String(student.whatsapp || '').trim();
          const exists = mergedRows.some(row => {
            const rowReg = String(row.reg_no || row.regNo || '').trim();
            const rowWhatsapp = String(row.whatsapp || '').trim();
            return (regNo && rowReg && regNo === rowReg) || (whatsapp && rowWhatsapp && whatsapp === rowWhatsapp);
          });
          if (!exists) {
            mergedRows.push({
              reg_no: regNo,
              regNo,
              full_name: student.full_name || student.fullName || student.name || '',
              fullName: student.full_name || student.fullName || student.name || '',
              student_class: student.student_class || student.class || '',
              class: student.student_class || student.class || '',
              medium: student.medium || '',
              school_name: student.school_name || student.schoolName || '',
              schoolName: student.school_name || student.schoolName || '',
              dob: normalizeDate(student.dob || student.DOB || '') || student.dob || student.DOB || '',
              parent_name: student.parent_name || student.parentName || '',
              parentName: student.parent_name || student.parentName || '',
              whatsapp,
              email: student.email || '',
              address: student.address || '',
              amount: student.amount || '',
              pay_mode: student.pay_mode || student.payMode || '',
              payMode: student.pay_mode || student.payMode || '',
              status: student.status || '',
              reg_date: normalizeDate(student.reg_date || student.regDate || '') || student.reg_date || student.regDate || ''
            });
          }
        }

        const formatted = mergedRows.map(r => {
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
        emailInfo = await queueRegistrationEmail(student, 'Online');
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

  app.post('/api/resources', requireAdminReleaseAccess, async (req, res) => {
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

  app.put('/api/resources/:id', requireAdminReleaseAccess, async (req, res) => {
    const resourceId = Number(req.params.id);
    if (!Number.isInteger(resourceId) || resourceId < 1) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }
    const resource = req.body;
    if (isDbConnected && connectionPool) {
      try {
        const existingResult = await connectionPool.query(`SELECT * FROM study_resources WHERE id = $1 LIMIT 1`, [resourceId]);
        const existing = getQueryRows(existingResult)[0];
        if (!existing) return res.status(404).json({ error: 'Resource not found.' });
        const result = await connectionPool.query(
          `UPDATE study_resources SET title=$1, category=$2, resource_type=$3, url=$4, description=$5, file_name=$6, file_data=$7 WHERE id=$8 RETURNING *`,
          [resource.title, resource.category, resource.type,
            resource.url === undefined ? existing.url : resource.url,
            resource.description === undefined ? existing.description : resource.description,
            resource.fileName === undefined ? existing.file_name : resource.fileName,
            resource.fileData === undefined ? existing.file_data : resource.fileData, resourceId]
        );
        if (!result || result.rowCount !== 1) return res.status(404).json({ error: 'Resource not found.' });
        const updated = getQueryRows(result)[0];
        return res.json({
          id: updated.id, title: updated.title, category: updated.category, type: updated.resource_type,
          url: updated.url, description: updated.description, fileName: updated.file_name,
          fileData: updated.file_data, createdAt: updated.created_at
        });
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
    if (idx === -1) return res.status(404).json({ error: 'Resource not found.' });
    global.__resources[idx] = { ...global.__resources[idx], ...resource, id: resourceId };
    res.json(global.__resources[idx]);
  });

  app.delete('/api/resources/:id', requireAdminReleaseAccess, async (req, res) => {
    const resourceId = Number(req.params.id);
    if (!Number.isInteger(resourceId) || resourceId < 1) {
      return res.status(400).json({ error: 'Invalid resource ID.' });
    }
    if (isDbConnected && connectionPool) {
      try {
        const result = await connectionPool.query(`DELETE FROM study_resources WHERE id = $1`, [resourceId]);
        if (!result || result.rowCount !== 1) {
          return res.status(404).json({ success: false, deleted: false, id: resourceId, error: 'Resource not found.' });
        }
        return res.json({ success: true, deleted: true, id: resourceId, message: 'Resource deleted successfully' });
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
    const initialLength = global.__resources.length;
    global.__resources = global.__resources.filter(r => r.id !== resourceId);
    if (global.__resources.length === initialLength) {
      return res.status(404).json({ success: false, deleted: false, id: resourceId, error: 'Resource not found.' });
    }
    res.json({ success: true, deleted: true, id: resourceId, message: 'Resource deleted successfully' });
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
