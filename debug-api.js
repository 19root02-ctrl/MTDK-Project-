const { createServer } = require('./server');
const fakePool = {
  query: async (sql) => {
    if (sql.includes('INSERT INTO students')) return [{ insertId: 1 }, null];
    if (sql.includes('SELECT') && sql.includes('FROM students')) return [[{ reg_no: 'IMTSE-10001', full_name: 'TEST USER' }], null];
    return [[], null];
  }
};

(async () => {
  const app = createServer({ pool: fakePool });
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });
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
      amount: '₹100.00',
      payMode: 'UPI',
      regNo: 'IMTSE-10001',
      status: 'Approved',
      regDate: '2026-07-19'
    })
  });
  console.log('status', response.status);
  console.log(await response.text());
  server.close();
})();
