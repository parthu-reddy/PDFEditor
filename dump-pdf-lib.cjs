const pdfLib = require('pdf-lib');
console.log(Object.keys(pdfLib).filter(k => k.toLowerCase().includes('stream')));
