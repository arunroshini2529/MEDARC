const fs = require('fs');
const p = 'c:\\Users\\Arun\\Desktop\\STUDY PLANNER\\index.html';
let content = fs.readFileSync(p, 'utf8');

const idx = content.indexOf('function renderTimerTask');
console.log('Current renderTimerTask:');
console.log(JSON.stringify(content.substring(idx, 350)));
