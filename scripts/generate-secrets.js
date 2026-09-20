import crypto from 'node:crypto';
console.log('SESSION_SECRET='+crypto.randomBytes(48).toString('base64url'));
console.log('SESSION_VAULT_KEY='+crypto.randomBytes(48).toString('base64url'));
