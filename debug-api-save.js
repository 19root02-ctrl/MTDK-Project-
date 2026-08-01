const fetch = global.fetch || require('node-fetch');
(async () => {
  try {
    const health = await fetch('http://127.0.0.1:3000/api/health');
    console.log('HEALTH STATUS', health.status);
    console.log(await health.text());
  } catch (err) {
    console.error('HEALTH ERROR', err.message);
  }

  try {
    const res = await fetch('http://127.0.0.1:3000/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'DEBUG USER',
        class: 'IV',
        medium: 'English',
        schoolName: 'DEBUG SCHOOL',
        dob: '2016-12-31',
        parentName: 'DEBUG PARENT',
        whatsapp: '9999999999',
        address: 'DEBUG ADDRESS',
        amount: '₹450.00',
        payMode: 'UPI',
        regNo: 'IMTSE-DEBUG-001',
        status: 'Approved',
        regDate: '19-July-2026'
      })
    });
    console.log('SAVE STATUS', res.status);
    console.log(await res.text());
  } catch (err) {
    console.error('SAVE ERROR', err.message);
  }
})();
