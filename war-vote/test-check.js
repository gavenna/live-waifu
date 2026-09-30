const { execSync } = require('child_process');
try {
  const check = execSync('cmd /c tasklist /FI "IMAGENAME eq javaw.exe" /NH', { encoding: 'utf-8', timeout: 5000, windowsHide: true });
  console.log('check:', JSON.stringify(check));
  console.log('includes:', check.includes('javaw.exe'));
} catch(e) {
  console.log('error:', e.message);
}