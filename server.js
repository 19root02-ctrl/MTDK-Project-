const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

dotenv.config({ path: path.join(__dirname, '.env') });  

// In-memory fallbacks
if (!global.__students) global.__students = [];
if (!global.__resources) global.__resources = [];

// ── Email Transporter (initialized on demand) ───────────────────────
let emailTransporter = null;
let emailTransporterIsTest = false;

async function ensureEmailTransporter() {
  if (emailTransporter) return emailTransporter;
  if (injectedEmailTransporter) {
    emailTransporter = injectedEmailTransporter;
    emailTransporterIsTest = false;
    return emailTransporter;
  }

  const smtpConfig = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    hasPassword: Boolean(process.env.SMTP_PASS),
    from: process.env.SMTP_USER || ''
  };
  console.log('[SMTP] Config prepared', JSON.stringify(smtpConfig));

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: (process.env.SMTP_SECURE === 'true'),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || ''
      }
    });
    emailTransporterIsTest = false;
    return emailTransporter;
  }

  try {
    const testAccount = await nodemailer.createTestAccount();
    emailTransporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    emailTransporterIsTest = true;
    console.log('Using Ethereal test account for email (development)');
    return emailTransporter;
  } catch (e) {
    console.warn('Could not create test email account:', e && e.message ? e.message : e);
    throw e;
  }
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

  try {
    const transporter = await ensureEmailTransporter();
    console.log('[SMTP] Verifying transporter connection');
    await transporter.verify();
    console.log('[SMTP] Transporter verification succeeded');
  } catch (e) {
    const errorMessage = e && e.message ? e.message : String(e);
    const errorStack = e && e.stack ? e.stack : '';
    console.error('[SMTP] Transporter verification failed');
    console.error('[SMTP] Error message:', errorMessage);
    if (errorStack) console.error('[SMTP] Error stack:', errorStack);
    if (e && e.code) console.error('[SMTP] Error code:', e.code);
    if (e && e.response) console.error('[SMTP] SMTP response:', e.response);
    return { ok: false, reason: 'transporter-failed', error: errorMessage };
  }

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
        Time: <strong>10:00 AM to 12:00 PM</strong><br>
        Exam Centre: <strong>MTDK School</strong><br>
        Admit Card Available From: <strong>${process.env.HALL_TICKET_UNLOCK_DATE || '01 August 2024 10:30'}</strong>
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
    const info = await emailTransporter.sendMail({
      from: `"IMTSE Portal" <${process.env.SMTP_USER}>`,
      to: studentEmail,
      subject: `IMTSE 2026-27 - Registration Confirmed | Reg No. ${regNo}`,
      html: emailBody,
      attachments: [
        {
          filename: `IMTSE_Registration_${regNo}.pdf`,
          content: pdfBuffer
        }
      ]
    });

    console.log('[EMAIL] Mail send result', {
      accepted: info && info.accepted,
      rejected: info && info.rejected,
      response: info && info.response,
      messageId: info && info.messageId
    });

    if (emailTransporterIsTest) {
      const previewUrl = nodemailer.getTestMessageUrl(info) || null;
      return { ok: true, previewUrl };
    }

    return { ok: true, messageId: info && info.messageId };
  } catch (e) {
    const errorMessage = e && e.message ? e.message : String(e);
    const errorStack = e && e.stack ? e.stack : '';
    console.error('[EMAIL] Mail send failed');
    console.error('[SMTP] Error message:', errorMessage);
    if (errorStack) console.error('[SMTP] Error stack:', errorStack);
    if (e && e.code) console.error('[SMTP] Error code:', e.code);
    if (e && e.response) console.error('[SMTP] SMTP response:', e.response);
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
    january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12
  };
  const cleaned = asString.replace(/[,]/g, '').replace(/\s+/g, ' ').trim();
  const humanMatch = cleaned.match(/^([0-9]{1,2})[- ]([A-Za-z]+)[- ]([0-9]{4})$/);
  if (humanMatch) {
    const day = Number(humanMatch[1]);
    const monthRaw = humanMatch[2].toLowerCase();
    const year = Number(humanMatch[3]);
    const month = monthNames[monthRaw];
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  return null;
}

async function generateRegistrationPdfBuffer(student) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A5', margin: 30 });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      doc.rect(0, 0, doc.page.width, 70).fill('#0f2b5c');
      doc.fillColor('white').fontSize(14).font('Helvetica-Bold').text('IGNITED MINDS TALENT SEARCH EXAM 2026-27', 30, 20, { align: 'center' });

      doc.moveDown(2);
      doc.fillColor('#1a1a2e').fontSize(12).font('Helvetica-Bold').text('Registration Details:', { underline: false });
      doc.moveDown(0.5);

      const lines = [
        ['Registration No.', student.reg_no || student.regNo || ''],
        ['Student Name', student.full_name || student.fullName || ''],
        ['Class & Medium', `${student.student_class || student.class || ''} - ${student.medium || ''}`],
        ['School Name', student.school_name || student.schoolName || ''],
        ['Amount Paid', student.amount || ''],
        ['Payment Mode', student.pay_mode || student.payMode || ''],
        ['Date of Registration', student.reg_date || student.regDate || ''],
        ['Exam Date', '14 February 2027'],
        ['Exam Time', '10:00 AM to 12:00 PM'],
        ['Exam Centre', 'MTDK School']
      ];

      let y = doc.y;
      lines.forEach(([label, val]) => {
        doc.fillColor('#64748b').fontSize(9).text(label, 30, y);
        doc.fillColor('#1a1a2e').fontSize(9).text(String(val || ''), 160, y);
        y += 16;
      });

      doc.moveTo(30, y + 8);
      doc.fillColor('#64748b').fontSize(8).text('Initiative by MTDK Shaikshnik Sankul', 30, doc.page.height - 40, { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

let connectionPool = null;
let isDbConnected = false;
let injectedEmailTransporter = null;

function setInjectedEmailTransporter(transporter) {
  injectedEmailTransporter = transporter;
  emailTransporter = transporter;
}

async function tryInitDatabase(providedPool = null) {
  if (providedPool) {
    connectionPool = providedPool;
    isDbConnected = true;
    return;
  }

  try {
    const databaseName =
  process.env.DB_NAME ||
  process.env.MYSQLDATABASE ||
  'imtse_portal';
      console.log("DB_HOST =", process.env.DB_HOST);
      console.log("MYSQLHOST =", process.env.MYSQLHOST);
      console.log("DB_PORT =", process.env.DB_PORT);
      console.log("MYSQLPORT =", process.env.MYSQLPORT);
      console.log("DB_NAME =", process.env.DB_NAME || process.env.MYSQLDATABASE);
   connectionPool = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQLHOST,
  port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
  user: process.env.DB_USER || process.env.MYSQLUSER,
  password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD,
  database: databaseName,
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
});

    await connectionPool.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\``);
    await connectionPool.query(`USE \`${databaseName}\``);
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
        status VARCHAR(100) NOT NULL DEFAULT 'Pending Verification',
        reg_date DATE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (whatsapp),
        UNIQUE KEY uniq_reg_no (reg_no)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    try {
      await connectionPool.query(`ALTER TABLE \`${databaseName}\`.students ADD COLUMN payment_screenshot_name VARCHAR(255) NULL AFTER pay_mode`.replace('\\`', '`'));
    } catch (e) {}
    try {
      await connectionPool.query(`ALTER TABLE \`${databaseName}\`.students ADD COLUMN payment_screenshot_data LONGTEXT NULL AFTER payment_screenshot_name`.replace('\\`', '`'));
    } catch (e) {}
    try {
      await connectionPool.query(`ALTER TABLE \`${databaseName}\`.students ADD COLUMN email VARCHAR(255) NULL AFTER whatsapp`);
    } catch (e) {}

    await connectionPool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connectionPool.query(`
      CREATE TABLE IF NOT EXISTS study_resources (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        resource_type VARCHAR(20) NOT NULL,
        url VARCHAR(1000) NULL,
        description TEXT NULL,
        file_name VARCHAR(255) NULL,
        file_data LONGTEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    isDbConnected = true;
    console.log('MySQL Database initialized successfully');
  } catch (err) {
    isDbConnected = false;
    console.warn('MySQL initialization failed, falling back to in-memory store:', err.message);
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

  tryInitDatabase(options.pool || null);

  app.get('/api/health', async (_req, res) => {
    res.json({ status: 'ok', dbConnected: isDbConnected });
  });

  app.get('/api/students', async (_req, res) => {
    if (isDbConnected && connectionPool) {
      try {
        const [rows] = await connectionPool.query('SELECT * FROM students ORDER BY created_at DESC');
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
        console.error('Failed to fetch students from DB, using fallback', error);
      }
    }
    return res.json(global.__students);
  });

  app.get('/api/students/:studentId', async (req, res) => {
    const identifier = String(req.params.studentId || '').trim();
    if (isDbConnected && connectionPool) {
      try {
        const [rows] = await connectionPool.query(
          `SELECT * FROM students WHERE reg_no = ? OR whatsapp = ? LIMIT 1`,
          [identifier, identifier]
        );
        if (rows && rows.length > 0) {
          const r = { ...rows[0] };
          if (r.dob instanceof Date) r.dob = r.dob.toISOString().split('T')[0];
          else if (typeof r.dob === 'string' && r.dob.indexOf('T') !== -1) r.dob = r.dob.split('T')[0];
          if (r.reg_date instanceof Date) r.reg_date = r.reg_date.toISOString().split('T')[0];
          else if (typeof r.reg_date === 'string' && r.reg_date.indexOf('T') !== -1) r.reg_date = r.reg_date.split('T')[0];
          return res.json(r);
        }
      } catch (e) {}
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

      if (isDbConnected && connectionPool) {
        try {
          const [existing] = await connectionPool.query('SELECT reg_no FROM students WHERE whatsapp = ? LIMIT 1', [whatsapp]);
          if (existing && existing.length > 0) return res.status(409).json({ error: 'Mobile number already registered.' });

          await connectionPool.query(`
            INSERT INTO students (reg_no, full_name, student_class, medium, school_name, dob, parent_name, whatsapp, email, address, amount, pay_mode, payment_screenshot_name, payment_screenshot_data, status, reg_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            student.regNo, student.fullName, student.class, student.medium, student.schoolName,
            dobValue, student.parentName, student.whatsapp, student.email || null,
            student.address, student.amount, student.payMode, student.paymentScreenshotName || null, student.paymentScreenshotData || null, student.status || 'Pending Verification', regDateValue
          ]);
        } catch (dbErr) {
          if (dbErr.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Mobile number already registered.' });
          }
          console.warn('DB save failed, persisting to in-memory store:', dbErr.message);
        }
      }

      // Store in memory cache
      const idx = global.__students.findIndex(s => s.whatsapp === whatsapp || (s.regNo && s.regNo === student.regNo));
      if (idx !== -1) global.__students[idx] = student;
      else global.__students.push(student);

      res.status(201).json({ regNo: student.regNo, message: 'Student saved successfully' });
    } catch (error) {
      console.error('Failed to save student', error);
      res.status(500).json({ error: 'Failed to save student', details: error.message });
    }
  });

  // ── APPROVE STUDENT (sends confirmation email with attached PDF) ────────
  app.post('/api/students/:studentId/approve', async (req, res) => {
    const identifier = String(req.params.studentId || '').trim();
    console.log('[APPROVAL] API entered', { identifier, body: req.body || {} });

    try {
      let student = null;

      if (isDbConnected && connectionPool) {
        try {
          const [rows] = await connectionPool.query(
            `SELECT * FROM students WHERE reg_no = ? OR whatsapp = ? LIMIT 1`,
            [identifier, identifier]
          );
          if (rows && rows.length > 0) student = rows[0];

          await connectionPool.query(
            `UPDATE students SET status = 'Approved & Active (Fees Paid)' WHERE reg_no = ? OR whatsapp = ?`,
            [identifier, identifier]
          );
        } catch (dbError) {
          console.error('[APPROVAL] Database update failed', dbError && dbError.message ? dbError.message : dbError);
        }
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

  // ── REJECT STUDENT ─────────────────────────────────────────────────
  app.post('/api/students/:studentId/reject', async (req, res) => {
    try {
      const identifier = String(req.params.studentId || '').trim();
      if (isDbConnected && connectionPool) {
        try {
          await connectionPool.query(`UPDATE students SET status = 'Rejected' WHERE reg_no = ? OR whatsapp = ?`, [identifier, identifier]);
        } catch (e) {}
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
            UPDATE students SET full_name=?, student_class=?, medium=?, school_name=?, dob=?,
              parent_name=?, whatsapp=?, email=?, address=?, amount=?, pay_mode=?, status=?, reg_date=?
            WHERE reg_no = ? OR whatsapp = ?
          `, [
            student.fullName, student.class, student.medium, student.schoolName, dobValue,
            student.parentName, student.whatsapp, student.email || null, student.address,
            student.amount, student.payMode, student.status || 'Pending Verification', regDateValue,
            identifier, identifier
          ]);
        } catch (e) {}
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
          await connectionPool.query('DELETE FROM students WHERE reg_no = ? OR whatsapp = ?', [identifier, identifier]);
        } catch (e) {}
      }
      global.__students = global.__students.filter(s => (s.regNo || s.reg_no) !== identifier && s.whatsapp !== identifier);
      res.json({ regNo: identifier, message: 'Student deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete student' });
    }
  });

  // Resource API Endpoints
  app.get('/api/resources', async (_req, res) => {
    if (isDbConnected && connectionPool) {
      try {
        const [rows] = await connectionPool.query(`SELECT * FROM study_resources ORDER BY created_at DESC`);
        return res.json((rows || []).map(r => ({
          id: r.id, title: r.title, category: r.category, type: r.resource_type,
          url: r.url, description: r.description, fileName: r.file_name, fileData: r.file_data, createdAt: r.created_at
        })));
      } catch (e) {}
    }
    res.json(global.__resources);
  });

  app.post('/api/resources', async (req, res) => {
    const resource = req.body;
    resource.id = resource.id || Date.now();
    if (isDbConnected && connectionPool) {
      try {
        const [result] = await connectionPool.query(
          `INSERT INTO study_resources (title, category, resource_type, url, description, file_name, file_data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [resource.title, resource.category, resource.type, resource.url || '', resource.description || '', resource.fileName || '', resource.fileData || '']
        );
        resource.id = result.insertId;
      } catch (e) {}
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
          `UPDATE study_resources SET title=?, category=?, resource_type=?, url=?, description=?, file_name=?, file_data=? WHERE id=?`,
          [resource.title, resource.category, resource.type, resource.url || '', resource.description || '', resource.fileName || '', resource.fileData || '', resourceId]
        );
      } catch (e) {}
    }
    const idx = global.__resources.findIndex(r => r.id === resourceId);
    if (idx !== -1) global.__resources[idx] = { ...global.__resources[idx], ...resource };
    res.json({ id: resourceId, message: 'Resource updated successfully' });
  });

  app.delete('/api/resources/:id', async (req, res) => {
    const resourceId = Number(req.params.id);
    if (isDbConnected && connectionPool) {
      try {
        await connectionPool.query(`DELETE FROM study_resources WHERE id = ?`, [resourceId]);
      } catch (e) {}
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
