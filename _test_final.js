require('dotenv').config();
const SekaliPayService = require('./sekalipayService');

const service = new SekaliPayService();

async function run() {
  console.log('=== VERIFIKASI PPOB SEKALIPAY (ACTIVE ENGINE) ===\n');

  const result = await service.getItems();
  const items = result.data || [];
  const ok = result.success && items.length > 0;

  console.log(`[${ok ? '✅' : '❌'}] SekaliPay Items Load: ${items.length} produk terdaftar (Cached: ${result.cached ? 'Ya' : 'Tidak'})\n`);

  const categories = [
    { label: 'PULSA & DATA', cat: 'Pulsa & Paket Data' },
    { label: 'GAMES', cat: 'Game' },
    { label: 'E-WALLET', cat: 'E-Wallet' },
    { label: 'TOKEN PLN', cat: 'Listrik' },
    { label: 'VOUCHER', cat: 'Voucher' }
  ];

  let allOk = ok;

  for (const item of categories) {
    const matched = items.filter(i => (i.category || '').toLowerCase() === item.cat.toLowerCase());
    const count = matched.length;
    const catOk = count > 0;
    if (!catOk) allOk = false;
    const sampleBrands = [...new Set(matched.map(m => m.brand))].slice(0, 5).join(', ');
    console.log(`[${catOk ? '✅' : '❌'}] ${item.label.padEnd(14)} | ${String(count).padStart(4)} produk | Brand sample: ${sampleBrands || '-'}`);
  }

  console.log('\n' + (allOk ? '🎉 SEMUA KATEGORI PPOB SEKALIPAY OK & SIAP DUGUNAKAN!' : '⚠️ ADA KATEGORI YANG KOSONG — cek log di atas'));
}

run().catch(console.error);

