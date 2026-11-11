const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

// Replace Rupee
content = content.replace(/â‚¹/g, 'Rs. ');

// Replace phone numbers globally
const old1 = 'For Vendor: <strong>7093776085</strong>';
const old2 = 'For Room Deliveries: <strong>7382076953</strong>';
const new1 = 'For Room Deliveries(Boys): <strong>9876027082</strong>';
const new2 = 'For Room Deliveries(Girls): <strong>9618263400</strong>';

while (content.includes(old1)) {
    content = content.replace(old1, new1);
}
while (content.includes(old2)) {
    content = content.replace(old2, new2);
}

// Ensure emojis are completely stripped
const badChars = ['ðŸ’š', 'ðŸšš', 'ðŸ“ž', 'ðŸ Ž', 'ðŸ’³', 'ðŸ” ', 'â Œ', 'âš ï¸ ', 'âœ…', 'â„¹ï¸ ', 'ï¿½', 'ðŸ”’', 'ðŸ ŽðŸ ŠðŸ ŒðŸ ‡ðŸ “', 'ðŸ Š', 'ðŸ Œ', 'ðŸ ‡', 'ðŸ “', 'â‚¹'];
for (const bad of badChars) {
    while(content.includes(bad)) {
        content = content.replace(bad, '');
    }
}

fs.writeFileSync('index.js', content, 'utf8');
console.log('Fixed index.js again');
