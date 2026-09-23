# IMTSE Examination Management Portal

A web-based Examination Management Portal developed for managing student registration, examination records, hall tickets, results, and administrative operations.

## Features

### Student Module
- Student registration
- Mobile Number + DOB based login
- Registration status
- Payment information
- Study resources
- Hall Ticket access
- Result access
- Secure student session
- Student-specific data access

### Admin Module
- Admin authentication
- Student management
- Online registration management
- Manual student registration through Excel
- Excel validation and bulk import
- Payment verification
- Study resource management
- Hall Ticket release control
- Result upload and management
- Result verification and publishing
- Email delivery status management

### Manual Registration
- Admin-only Excel upload
- Automatic Registration Number generation
- Duplicate Registration Number prevention
- Duplicate Mobile Number validation
- DOB validation
- Multiple DOB format support
- Automatic Active/Approved status
- Primary and Secondary student classification
- Centralized email queue

### Email Management
Email delivery is handled through a centralized queue.

Status:
- SENT
- WAITING / PENDING
- FAILED

Email delivery does not block student registration or student access.

### Result Management

#### Primary – Standards 1 to 4
- Marathi
- English
- Mathematics
- EVS
- Logical Reasoning
- Total

#### Secondary – Standards 5 to 10
- Marathi
- English
- Mathematics & Logical Reasoning
- EVS / Science
- Social Science
- Total

Results are uploaded through Excel and published by the Admin.

### Security
- Admin-only protected management operations
- Authenticated student sessions
- Student can access only their own data
- Cross-student result access is blocked
- Protected result upload, verification and publishing
- Server-side authorization

## Technology Stack

### Frontend
- HTML
- CSS
- JavaScript

### Backend
- Node.js
- Express.js

### Database
- PostgreSQL

### Email
- Brevo / Centralized Email Queue

### Development Tools
- Git
- GitHub
- VS Code
- npm

## Project Structure

```text
imtse_web_portal/
│
├── app.js
├── server.js
├── index.html
├── index.css
├── tests/
│   └── api.test.js
├── package.json
├── package-lock.json
└── README.md
```

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/19root02-ctrl/MTDK-Project-.git
```

### 2. Open the project

```bash
cd MTDK-Project-
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

Create a `.env` file and configure the required database, email, authentication, and application environment variables.

**Do not commit `.env` or credentials to GitHub.**

### 5. Start the application

```bash
npm start
```

## Testing

Run the automated test suite:

```bash
npm test
```

Latest verification:
- 41 tests passed
- 0 tests failed

Additional checks:

```bash
node --check app.js
node --check server.js
git diff --check
```

## Security & Data Protection

- Do not commit `.env` files.
- Do not expose database credentials or API keys.
- Do not commit real student Excel data.
- Do not commit testing workbooks containing student information.
- Keep production credentials in environment variables.
- Student data access is protected by authenticated sessions and server-side authorization.

## Student Registration & Result Flow

```text
Student Registration
        ↓
Admin Verification / Approval
        ↓
Student Login
(Mobile Number + DOB)
        ↓
Hall Ticket
        ↓
Examination
        ↓
Admin Result Upload
        ↓
Result Verification
        ↓
Result Publish
        ↓
Student Result
```

## Manual Registration Flow

```text
Admin
  ↓
Upload Excel
  ↓
Validate Records
  ↓
Preview
  ↓
Confirm Import
  ↓
Generate Registration Numbers
  ↓
Students Become Active / Approved
  ↓
Centralized Email Queue
```

## Project Purpose

The IMTSE Examination Management Portal provides a centralized system for examination-related operations, including student registration, manual bulk registration, payment management, hall ticket handling, result management, email status tracking, and administrative control.

## Developer

**Sairaj Magdum**

AI/ML & Backend Developer

GitHub: `sairajmagdum1908-prog`
