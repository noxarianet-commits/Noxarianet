/**
 * Script Migrasi Data dari SQLite / JSON ke Supabase PostgreSQL
 * 
 * Penggunaan:
 * 1. Tambahkan SUPABASE_DB_URL ke file .env
 *    Contoh: SUPABASE_DB_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
 * 2. Jalankan perintah: node migrate_to_supabase.js
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

let pg = null;
try {
  pg = require('pg');
} catch (e) {
  console.error('❌ Modul "pg" belum terpasang. Silakan jalankan: npm install pg');
  process.exit(1);
}

const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ SUPABASE_DB_URL atau DATABASE_URL belum diatur di file .env.');
  console.log('Contoh format URL Supabase:');
  console.log('SUPABASE_DB_URL=postgresql://postgres.xxx:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres');
  process.exit(1);
}

let sqlite3 = null;
try {
  sqlite3 = require('sqlite3').verbose();
} catch (e) {
  console.log('ℹ️ sqlite3 tidak terpasang, akan membaca fallback JSON file.');
}

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

function readJSONFile(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

async function getSqliteRows(sql) {
  if (!sqlite3) return [];
  const dbPath = path.join(__dirname, process.env.DATABASE_FILE || 'data.sqlite');
  if (!fs.existsSync(dbPath)) return [];
  
  return new Promise((resolve) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return resolve([]);
    });
    db.all(sql, [], (err, rows) => {
      db.close();
      if (err) resolve([]);
      else resolve(rows || []);
    });
  });
}

async function migrate() {
  console.log('🚀 Memulai migrasi data ke Supabase...');
  const client = await pool.connect();

  try {
    // 1. Migrasi USERS
    console.log('📦 Memeriksa data Users...');
    let users = await getSqliteRows('SELECT * FROM users');
    if (users.length === 0) {
      users = readJSONFile(path.join(__dirname, 'users.json'), []);
    }
    console.log(`Ditemukan ${users.length} akun user.`);
    for (const u of users) {
      await client.query(`
        INSERT INTO users (
          username, password, fullname, brand, userId, waContact, email,
          mainBalance, qrisBalance, role, transactionPin, isSuspended,
          suspendReason, lastDeviceId, activeSessions, lastIp, lastDevice,
          lastLocation, createdAt, updatedAt
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,COALESCE($19::timestamptz, NOW()),COALESCE($20::timestamptz, NOW()))
        ON CONFLICT (username) DO UPDATE SET
          password = EXCLUDED.password,
          fullname = EXCLUDED.fullname,
          mainBalance = EXCLUDED.mainBalance,
          qrisBalance = EXCLUDED.qrisBalance,
          role = EXCLUDED.role,
          transactionPin = EXCLUDED.transactionPin,
          isSuspended = EXCLUDED.isSuspended;
      `, [
        u.username, u.password || '', u.fullname || '', u.brand || '', u.userId || '',
        u.waContact || '', u.email || '', Number(u.mainBalance || 0), Number(u.qrisBalance || 0),
        u.role || 'MEMBER', u.transactionPin || '', u.isSuspended ? 1 : 0,
        u.suspendReason || '', u.lastDeviceId || '', u.activeSessions || '',
        u.lastIp || '', u.lastDevice || '', u.lastLocation || '',
        u.createdAt || null, u.updatedAt || null
      ]);
    }
    console.log('✅ Users berhasil dimigrasikan.');

    // 2. Migrasi ADMINS
    console.log('📦 Memeriksa data Admin...');
    let admins = await getSqliteRows('SELECT * FROM admin_users');
    if (admins.length === 0) {
      admins = readJSONFile(path.join(__dirname, 'admins.json'), []);
    }
    for (const a of admins) {
      await client.query(`
        INSERT INTO admin_users (username, password, fullname)
        VALUES ($1, $2, $3)
        ON CONFLICT (username) DO NOTHING;
      `, [a.username, a.password || 'andika123', a.fullname || 'Administrator']);
    }
    console.log('✅ Admin users berhasil dimigrasikan.');

    // 3. Migrasi TRANSACTIONS
    console.log('📦 Memeriksa data Transactions...');
    const txs = await getSqliteRows('SELECT * FROM transactions');
    console.log(`Ditemukan ${txs.length} transaksi.`);
    for (const t of txs) {
      await client.query(`
        INSERT INTO transactions (
          id, username, orderId, merchant, product_name, target, account_name,
          base_price, adminFee, markup, amount, status, type, sn,
          product_license, note, failureReason, rawResponse, apiMessage,
          balanceRefunded, date, time, createdAt
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,COALESCE($23::timestamptz, NOW()))
        ON CONFLICT (id) DO NOTHING;
      `, [
        t.id, t.username, t.orderId || '', t.merchant || '', t.product_name || '',
        t.target || '', t.account_name || '', Number(t.base_price || 0), Number(t.adminFee || 0),
        Number(t.markup || 0), Number(t.amount || 0), t.status || 'PENDING', t.type || '',
        t.sn || '', t.product_license || '', t.note || '', t.failureReason || '',
        t.rawResponse || '', t.apiMessage || '', t.balanceRefunded ? 1 : 0,
        t.date || '', t.time || '', t.createdAt || null
      ]);
    }
    console.log('✅ Transactions berhasil dimigrasikan.');

    // 4. Migrasi PAYMENTS
    console.log('📦 Memeriksa data Payments / Deposits...');
    let payments = await getSqliteRows('SELECT * FROM payments');
    if (payments.length === 0) {
      payments = readJSONFile(path.join(__dirname, 'payments.json'), []);
    }
    for (const p of payments) {
      await client.query(`
        INSERT INTO payments (id, idDepo, username, amount, nominalTotal, status, paymentUrl, qrUrl, createdAt, updatedAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, NOW()), COALESCE($10::timestamptz, NOW()))
        ON CONFLICT (id) DO NOTHING;
      `, [
        p.id, p.idDepo || '', p.username, Number(p.amount || 0), Number(p.nominalTotal || 0),
        p.status || 'PENDING', p.paymentUrl || '', p.qrUrl || '', p.createdAt || null, p.updatedAt || null
      ]);
    }
    console.log('✅ Payments berhasil dimigrasikan.');

    // 5. Migrasi WITHDRAWALS
    console.log('📦 Memeriksa data Withdrawals...');
    let withdrawals = await getSqliteRows('SELECT * FROM withdrawals');
    if (withdrawals.length === 0) {
      withdrawals = readJSONFile(path.join(__dirname, 'withdrawals.json'), []);
    }
    for (const w of withdrawals) {
      await client.query(`
        INSERT INTO withdrawals (
          id, transactionId, clientRequestId, username, fullname, destination,
          method, amount, adminFee, totalDeducted, orderId, merchant,
          status, gatewayStatus, type, balanceRefunded, apiMessage,
          failureReason, rawResponse, createdAt
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,COALESCE($20::timestamptz, NOW()))
        ON CONFLICT (id) DO NOTHING;
      `, [
        w.id, w.transactionId || '', w.clientRequestId || '', w.username, w.fullname || '',
        w.destination || '', w.method || '', Number(w.amount || 0), Number(w.adminFee || 0),
        Number(w.totalDeducted || 0), w.orderId || '', w.merchant || '', w.status || '',
        w.gatewayStatus || '', w.type || '', w.balanceRefunded ? 1 : 0,
        w.apiMessage || '', w.failureReason || '', w.rawResponse || '', w.createdAt || null
      ]);
    }
    console.log('✅ Withdrawals berhasil dimigrasikan.');

    // 6. Migrasi BANNERS & INFORMATIONS
    let banners = await getSqliteRows('SELECT * FROM banners');
    if (banners.length === 0) banners = readJSONFile(path.join(__dirname, 'banners.json'), []);
    for (const b of banners) {
      await client.query(`
        INSERT INTO banners (id, title, imageUrl, link, active, createdAt)
        VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))
        ON CONFLICT (id) DO NOTHING;
      `, [b.id, b.title || 'Banner', b.imageUrl || '', b.link || '', b.active !== false ? 1 : 0, b.createdAt || null]);
    }

    let infos = await getSqliteRows('SELECT * FROM informations');
    if (infos.length === 0) infos = readJSONFile(path.join(__dirname, 'informations.json'), []);
    for (const i of infos) {
      await client.query(`
        INSERT INTO informations (id, title, contentTitle, content, date, time, active, createdAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()))
        ON CONFLICT (id) DO NOTHING;
      `, [i.id, i.title, i.contentTitle || i.title, i.content || '', i.date || '', i.time || '', i.active !== false ? 1 : 0, i.createdAt || null]);
    }
    console.log('✅ Banners & Informasi berhasil dimigrasikan.');

    console.log('\n🎉 SELURUH DATA BERHASIL DIMIGRASIKAN KE SUPABASE!');
  } catch (err) {
    console.error('❌ Terjadi kesalahan saat migrasi:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
