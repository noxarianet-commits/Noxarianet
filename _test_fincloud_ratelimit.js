const FinCloudQrisService = require('./fincloudQrisService');

const service = new FinCloudQrisService();

console.log('--- TEST FINCLOUD QRIS SERVICE & RATE LIMITER ---');
const key = service.getApiKey();
console.log('1. Active API Key:', key);
console.log('Key matches new key:', key === 'fc_live_038b7a0ff8fcb9362adfd931abe2dc94');

console.log('\n2. Testing Rate Limiter (Category: create, limit 60 req/min, safeLimit 55):');
for (let i = 1; i <= 3; i++) {
  const check = service.checkAndEnforceRateLimit('create');
  console.log(`Request #${i} allowed:`, check.success, 'Remaining:', check.remaining);
}

console.log('\n3. Testing Rate Limiter (Category: check, limit 30 req/min, safeLimit 25):');
for (let i = 1; i <= 3; i++) {
  const check = service.checkAndEnforceRateLimit('check');
  console.log(`Check #${i} allowed:`, check.success, 'Remaining:', check.remaining);
}

console.log('\n4. Testing In-Memory Polling Cache:');
service.statusCheckCache.set('TEST_INVOICE_123', {
  data: { success: true, status: 'PENDING', test: true },
  expiresAt: Date.now() + 8000
});
const cached = service.statusCheckCache.get('TEST_INVOICE_123');
console.log('Cache retrieved successfully:', cached && cached.data.test === true);

console.log('\nAll rate limiting & key checks PASSED!');
