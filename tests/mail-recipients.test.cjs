const assert=require('node:assert/strict');
const {replyRecipients,validateRecipients}=require('../functions/src/mail-recipients');
const mail={mittente:['bank@example.com'],replyTo:['advisor@example.com'],destinatari:['me@example.com','other@example.com'],cc:['CC@example.com','other@example.com','me@example.com','cc@example.com']};
assert.deepEqual(replyRecipients(mail,['ME@example.com'],false),{to:['advisor@example.com'],cc:[]});
assert.deepEqual(replyRecipients(mail,['me@example.com'],true),{to:['advisor@example.com','other@example.com'],cc:['cc@example.com']});
assert.deepEqual(replyRecipients({...mail,direzione:'inviata'},['me@example.com'],true),{to:['other@example.com'],cc:['cc@example.com']});
assert.deepEqual(validateRecipients('Extra@example.com; extra@example.com, me@example.com',['me@example.com']),['extra@example.com']);
for(const invalid of ['a@example.com\r\nBcc: b@example.com','not an address','a@example.com b@example.com'])assert.throws(()=>validateRecipients(invalid));
console.log('PASS reply-all: original To/Cc separate, Reply-To priority, own address removed, duplicates removed, sent-mail recipients, edits validated, header injection rejected');
