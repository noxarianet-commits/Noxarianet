const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, process.env.DATABASE_FILE || 'data.sqlite');
const backupDir = path.join(__dirname, 'backup_json');

// Backup existing JSON files
function backupJsonFiles() {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filesToBackup = ['db.json', 'users.json', 'topup_requests.json', 'config.json'];

  filesToBackup.forEach(filename => {
    const src = path.join(__dirname, filename);
    if (fs.existsSync(src)) {
      const dest = path.join(backupDir, `${filename}.${timestamp}.bak`);
      fs.copyFileSync(src, dest);
      console.log(`[Backup] Backed up ${filename} -> ${path.basename(dest)}`);
    }
  });
}

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function migrate() {
  console.log('====================================================');
  console.log('🚀 STARTING IDEMPOTENT MIGRATION: JSON -> SQLite (data.sqlite)');
  console.log('====================================================');

  backupJsonFiles();

  const db = new sqlite3.Database(dbPath);

  try {
    // 1. Create Schema Tables
    console.log('[SQLite Schema] Initializing tables...');

    await runSql(db, `
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        fullname TEXT,
        brand TEXT,
        userId TEXT,
        email TEXT,
        waContact TEXT,
        mainBalance INTEGER DEFAULT 0,
        qrisBalance INTEGER DEFAULT 0,
        role TEXT DEFAULT 'MEMBER',
        transactionPin TEXT,
        lastIp TEXT,
        lastDevice TEXT,
        lastLocation TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await runSql(db, `
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        orderId TEXT,
        merchant TEXT,
        product_name TEXT,
        target TEXT,
        account_name TEXT,
        base_price INTEGER DEFAULT 0,
        adminFee INTEGER DEFAULT 0,
        markup INTEGER DEFAULT 0,
        amount INTEGER DEFAULT 0,
        status TEXT DEFAULT 'PENDING',
        type TEXT,
        sn TEXT,
        product_license TEXT,
        note TEXT,
        failureReason TEXT,
        rawResponse TEXT,
        apiMessage TEXT,
        balanceRefunded INTEGER DEFAULT 0,
        date TEXT,
        time TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
      );
    `);

    await runSql(db, `
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        idDepo TEXT,
        username TEXT NOT NULL,
        amount INTEGER DEFAULT 0,
        nominalTotal INTEGER DEFAULT 0,
        status TEXT DEFAULT 'PENDING',
        paymentUrl TEXT,
        qrUrl TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
      );
    `);

    await runSql(db, `
      CREATE TABLE IF NOT EXISTS withdrawals (
        id TEXT PRIMARY KEY,
        transactionId TEXT,
        clientRequestId TEXT,
        username TEXT NOT NULL,
        fullname TEXT,
        destination TEXT,
        method TEXT,
        amount INTEGER DEFAULT 0,
        adminFee INTEGER DEFAULT 0,
        totalDeducted INTEGER DEFAULT 0,
        orderId TEXT,
        merchant TEXT,
        status TEXT,
        gatewayStatus TEXT,
        type TEXT,
        balanceRefunded INTEGER DEFAULT 0,
        apiMessage TEXT,
        failureReason TEXT,
        rawResponse TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
      );
    `);

    await runSql(db, `
      CREATE TABLE IF NOT EXISTS banners (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        imageUrl TEXT NOT NULL,
        link TEXT,
        active INTEGER DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await runSql(db, `
      CREATE TABLE IF NOT EXISTS informations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        contentTitle TEXT,
        content TEXT NOT NULL,
        date TEXT,
        time TEXT,
        active INTEGER DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await runSql(db, `
      CREATE TABLE IF NOT EXISTS ppob_visibility (
        sku TEXT PRIMARY KEY,
        active INTEGER DEFAULT 1,
        category TEXT,
        brand TEXT,
        markup INTEGER DEFAULT 0,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await runSql(db, `
      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Indexes
    await runSql(db, `CREATE INDEX IF NOT EXISTS idx_transactions_username ON transactions(username);`);
    await runSql(db, `CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);`);
    await runSql(db, `CREATE INDEX IF NOT EXISTS idx_payments_username ON payments(username);`);
    await runSql(db, `CREATE INDEX IF NOT EXISTS idx_withdrawals_username ON withdrawals(username);`);

    console.log('[SQLite Schema] Schema initialization completed.');

    // 2. Read DB JSON Files
    const dbJsonPath = path.join(__dirname, 'db.json');
    const usersJsonPath = path.join(__dirname, 'users.json');
    const topupsJsonPath = path.join(__dirname, 'topup_requests.json');

    let dbJsonData = {};
    if (fs.existsSync(dbJsonPath)) {
      try {
        dbJsonData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
      } catch (e) {
        console.error('[Migration Error] Reading db.json:', e.message);
      }
    }

    let usersJsonData = [];
    if (fs.existsSync(usersJsonPath)) {
      try {
        usersJsonData = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));
      } catch (e) {
        console.error('[Migration Error] Reading users.json:', e.message);
      }
    }

    let topupsJsonData = [];
    if (fs.existsSync(topupsJsonPath)) {
      try {
        topupsJsonData = JSON.parse(fs.readFileSync(topupsJsonPath, 'utf8'));
      } catch (e) {
        console.error('[Migration Error] Reading topup_requests.json:', e.message);
      }
    }

    await runSql(db, 'BEGIN TRANSACTION;');

    // 3. Migrate Users & Transactions from db.json
    let userCount = 0;
    let txCount = 0;

    if (dbJsonData.users && typeof dbJsonData.users === 'object') {
      for (const [uname, u] of Object.entries(dbJsonData.users)) {
        const username = uname || u.username || u.waContact;
        if (!username) continue;

        const mainBal = u.mainBalance !== undefined ? Math.ceil(Number(u.mainBalance) || 0) : Math.ceil(Number(u.saldo) || 0);
        const qrisBal = Math.ceil(Number(u.qrisBalance) || 0);
        const pin = u.transactionPin || u.pin || null;

        await runSql(db, `
          INSERT INTO users (
            username, password, fullname, brand, userId, email, waContact,
            mainBalance, qrisBalance, role, transactionPin, lastIp, lastDevice, lastLocation
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(username) DO UPDATE SET
            password = excluded.password,
            fullname = excluded.fullname,
            brand = excluded.brand,
            mainBalance = excluded.mainBalance,
            qrisBalance = excluded.qrisBalance,
            transactionPin = COALESCE(excluded.transactionPin, users.transactionPin);
        `, [
          username,
          u.password || '',
          u.fullname || username,
          u.brand || u.fullname || username,
          u.userId || username,
          u.email || '',
          u.waContact || username,
          mainBal,
          qrisBal,
          u.role || 'MEMBER',
          pin,
          u.lastIp || '',
          u.lastDevice || '',
          u.lastLocation || ''
        ]);

        userCount++;

        // Migrate User History into transactions table
        if (Array.isArray(u.history)) {
          for (const h of u.history) {
            if (!h.id) continue;
            const rawResp = typeof h.rawResponse === 'object' && h.rawResponse !== null ? JSON.stringify(h.rawResponse) : (h.rawResponse || null);
            await runSql(db, `
              INSERT OR REPLACE INTO transactions (
                id, username, orderId, merchant, product_name, target, account_name,
                base_price, adminFee, markup, amount, status, type, sn, product_license,
                note, failureReason, rawResponse, apiMessage, balanceRefunded, date, time, createdAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            `, [
              h.id,
              username,
              h.orderId || '',
              h.merchant || h.product_name || '',
              h.product_name || h.merchant || '',
              h.target || h.noTujuan || h.phoneNumber || '',
              h.account_name || '',
              Math.ceil(Number(h.base_price) || 0),
              Math.ceil(Number(h.adminFee) || 0),
              Math.ceil(Number(h.markup) || 0),
              Math.ceil(Number(h.amount) || 0),
              h.status || 'BERHASIL',
              h.type || 'PPOB',
              h.sn || h.product_license || '',
              h.product_license || h.sn || '',
              h.note || h.description || '',
              h.failureReason || '',
              rawResp,
              h.apiMessage || '',
              h.balanceRefunded ? 1 : 0,
              h.date || '',
              h.time || '',
              h.createdAt || new Date().toISOString()
            ]);
            txCount++;
          }
        }
      }
    }

    // 4. Migrate Standalone Users from users.json (if missing from db.json)
    if (Array.isArray(usersJsonData)) {
      for (const u of usersJsonData) {
        if (!u.username && !u.email) continue;
        const uname = u.username || u.email;
        await runSql(db, `
          INSERT INTO users (username, password, fullname, email, mainBalance, role)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(username) DO NOTHING;
        `, [
          uname,
          '',
          u.name || uname,
          u.email || '',
          Math.ceil(Number(u.saldo) || 0),
          'MEMBER'
        ]);
      }
    }

    // 5. Migrate Payments from db.json & topup_requests.json
    let paymentCount = 0;
    if (Array.isArray(dbJsonData.payments)) {
      for (const p of dbJsonData.payments) {
        if (!p.id) continue;
        await runSql(db, `
          INSERT INTO payments (id, idDepo, username, amount, nominalTotal, status, paymentUrl, qrUrl, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            updatedAt = excluded.updatedAt;
        `, [
          p.id,
          p.idDepo || p.id,
          p.username || '',
          Math.ceil(Number(p.amount) || 0),
          Math.ceil(Number(p.nominalTotal) || Number(p.amount) || 0),
          p.status || 'PENDING',
          p.paymentUrl || '',
          p.qrUrl || '',
          p.createdAt || new Date().toISOString(),
          p.updatedAt || new Date().toISOString()
        ]);
        paymentCount++;
      }
    }

    if (Array.isArray(topupsJsonData)) {
      for (const t of topupsJsonData) {
        const refId = t.ref_id || t.invoice || (t.id ? `TOPUP_${t.id}` : null);
        if (!refId) continue;
        const uname = t.username || t.user_id || '';
        await runSql(db, `
          INSERT INTO payments (id, idDepo, username, amount, nominalTotal, status, paymentUrl, qrUrl, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            updatedAt = excluded.updatedAt;
        `, [
          refId,
          t.invoice || refId,
          uname,
          Math.ceil(Number(t.amount) || Number(t.total_amount) || 0),
          Math.ceil(Number(t.total_amount) || Number(t.amount) || 0),
          String(t.status || 'PENDING').toUpperCase(),
          t.payment_link || '',
          t.qr_link || t.qr_url || '',
          t.created_at || new Date().toISOString(),
          t.updated_at || new Date().toISOString()
        ]);
      }
    }

    // 6. Migrate Withdrawals from db.json
    let withdrawCount = 0;
    if (Array.isArray(dbJsonData.withdrawals)) {
      for (const w of dbJsonData.withdrawals) {
        if (!w.id) continue;
        const rawResp = typeof w.rawResponse === 'object' && w.rawResponse !== null ? JSON.stringify(w.rawResponse) : (w.rawResponse || null);
        await runSql(db, `
          INSERT INTO withdrawals (
            id, transactionId, clientRequestId, username, fullname, destination, method,
            amount, adminFee, totalDeducted, orderId, merchant, status, gatewayStatus,
            type, balanceRefunded, apiMessage, failureReason, rawResponse, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            gatewayStatus = excluded.gatewayStatus;
        `, [
          w.id,
          w.transactionId || w.id,
          w.clientRequestId || '',
          w.username || '',
          w.fullname || '',
          w.destination || '',
          w.method || '',
          Math.ceil(Number(w.amount) || 0),
          Math.ceil(Number(w.adminFee) || 0),
          Math.ceil(Number(w.totalDeducted) || 0),
          w.orderId || '',
          w.merchant || '',
          w.status || 'DIPROSES',
          w.gatewayStatus || '',
          w.type || 'WITHDRAW',
          w.balanceRefunded ? 1 : 0,
          w.apiMessage || '',
          w.failureReason || '',
          rawResp,
          w.createdAt || new Date().toISOString()
        ]);
        withdrawCount++;
      }
    }

    // 7. Migrate Banners
    let bannerCount = 0;
    if (Array.isArray(dbJsonData.banners)) {
      for (const b of dbJsonData.banners) {
        if (!b.id) continue;
        await runSql(db, `
          INSERT INTO banners (id, title, imageUrl, link, active, createdAt)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            imageUrl = excluded.imageUrl,
            active = excluded.active;
        `, [
          b.id,
          b.title || 'Banner Promo',
          b.imageUrl || '',
          b.link || '',
          b.active !== false ? 1 : 0,
          b.createdAt || new Date().toISOString()
        ]);
        bannerCount++;
      }
    }

    // 8. Migrate Informations
    let infoCount = 0;
    if (Array.isArray(dbJsonData.informations)) {
      for (const i of dbJsonData.informations) {
        if (!i.id) continue;
        await runSql(db, `
          INSERT INTO informations (id, title, contentTitle, content, date, time, active, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            content = excluded.content,
            active = excluded.active;
        `, [
          i.id,
          i.title || 'Pengumuman',
          i.contentTitle || i.title || '',
          i.content || '',
          i.date || '',
          i.time || '',
          i.active !== false ? 1 : 0,
          i.createdAt || new Date().toISOString()
        ]);
        infoCount++;
      }
    }

    // 9. Migrate PPOB Visibility
    let ppobVisCount = 0;
    if (dbJsonData.ppobVisibility && typeof dbJsonData.ppobVisibility === 'object') {
      for (const [sku, vis] of Object.entries(dbJsonData.ppobVisibility)) {
        if (!sku) continue;
        await runSql(db, `
          INSERT INTO ppob_visibility (sku, active, category, brand, markup)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(sku) DO UPDATE SET
            active = excluded.active,
            markup = excluded.markup;
        `, [
          sku,
          vis.active !== false ? 1 : 0,
          vis.category || '',
          vis.brand || '',
          Math.max(0, Math.ceil(Number(vis.markup) || 0))
        ]);
        ppobVisCount++;
      }
    }

    // 10. Migrate App Config
    if (dbJsonData.config && typeof dbJsonData.config === 'object') {
      for (const [key, val] of Object.entries(dbJsonData.config)) {
        await runSql(db, `
          INSERT INTO app_config (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value;
        `, [
          key,
          JSON.stringify(val)
        ]);
      }
    }

    await runSql(db, 'COMMIT;');

    console.log('====================================================');
    console.log('✅ MIGRATION SUCCESSFUL! STATS:');
    console.log(`   - Users Migrated        : ${userCount}`);
    console.log(`   - Transactions Migrated : ${txCount}`);
    console.log(`   - Payments (Deposit)    : ${paymentCount}`);
    console.log(`   - Withdrawals           : ${withdrawCount}`);
    console.log(`   - Banners               : ${bannerCount}`);
    console.log(`   - Informations          : ${infoCount}`);
    console.log(`   - PPOB Visibilities     : ${ppobVisCount}`);
    console.log('====================================================');
  } catch (err) {
    await runSql(db, 'ROLLBACK;').catch(() => {});
    console.error('❌ MIGRATION FAILED:', err.message);
    throw err;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  migrate().catch(() => process.exit(1));
}

module.exports = migrate;
