const { createServer } = require('./server');
const fakePool = {
  query: async (sql, params) => {
    if (sql.includes('CREATE DATABASE')) return [[], null];
    if (sql.includes('CREATE TABLE')) return [[], null];
    if (sql.includes('SELECT 1')) return [[{ '1': 1 }], null];
    if (sql.includes('INSERT INTO students')) return [{ insertId: 1 }, null];
    if (sql.includes('SELECT reg_no FROM students WHERE whatsapp = ? LIMIT 1')) return [[], null];
    if (sql.includes('SELECT * FROM students WHERE reg_no = ? OR whatsapp = ? LIMIT 1')) return [[{ reg_no: 'IMTSE-10001', whatsapp: '1234567890' }], null];
    if (sql.includes('DELETE FROM students WHERE reg_no = ? OR whatsapp = ?')) return [{ affectedRows: 1 }, null];
    if (sql.includes('SELECT') && sql.includes('FROM students')) return [[{ reg_no: 'IMTSE-10001', full_name: 'TEST USER', student_class: 'VII', medium: 'English', school_name: 'TEST SCHOOL', dob: '2014-08-15', parent_name: 'TEST PARENT', whatsapp: '1234567890', address: 'TEST ADDRESS', amount: '?100.00', pay_mode: 'UPI', status: 'Approved', reg_date: '2026-07-19' }], null];
    return [[], null];
  }
};
(async () => {
  const server = createServer({ pool: fakePool });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'TEST USER', class: 'VII', medium: 'English', schoolName: 'TEST SCHOOL', dob: '2014-08-15', parentName: 'TEST PARENT', whatsapp: '1234567890', address: 'TEST ADDRESS', amount: '?100.00', payMode: 'UPI', regNo: 'IMTSE-10001', status: 'Approved', regDate: '2026-07-19' })
  });
  console.log('status', response.status);
  console.log(await response.text());
  server.close();
})();
