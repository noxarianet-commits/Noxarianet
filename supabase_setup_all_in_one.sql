-- ==============================================================================
-- NOXARIANET WALLET - SUPABASE ALL-IN-ONE SQL SCRIPT
-- Salin (copy) SELURUH isi kode ini dan tempel (paste) di Supabase SQL Editor
-- Lalu klik tombol "RUN" (Ctrl + Enter)
-- ==============================================================================

-- 1. TABEL PENGGUNA (USERS)
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  fullname TEXT,
  brand TEXT,
  userId TEXT,
  waContact TEXT,
  email TEXT,
  mainBalance BIGINT DEFAULT 0,
  qrisBalance BIGINT DEFAULT 0,
  role TEXT DEFAULT 'MEMBER',
  transactionPin TEXT,
  isSuspended INT DEFAULT 0,
  suspendReason TEXT,
  lastDeviceId TEXT,
  activeSessions TEXT,
  lastIp TEXT,
  lastDevice TEXT,
  lastLocation TEXT,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABEL TRANSAKSI (TRANSACTIONS)
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  orderId TEXT,
  merchant TEXT,
  product_name TEXT,
  target TEXT,
  account_name TEXT,
  base_price BIGINT DEFAULT 0,
  adminFee BIGINT DEFAULT 0,
  markup BIGINT DEFAULT 0,
  amount BIGINT DEFAULT 0,
  status TEXT DEFAULT 'PENDING',
  type TEXT,
  sn TEXT,
  product_license TEXT,
  note TEXT,
  failureReason TEXT,
  rawResponse TEXT,
  apiMessage TEXT,
  balanceRefunded INT DEFAULT 0,
  date TEXT,
  time TEXT,
  createdAt TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transactions_username ON transactions(username);
CREATE INDEX IF NOT EXISTS idx_transactions_createdat ON transactions(createdAt DESC);

-- 3. TABEL DEPOSIT / PEMBAYARAN (PAYMENTS)
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  idDepo TEXT,
  username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  amount BIGINT DEFAULT 0,
  nominalTotal BIGINT DEFAULT 0,
  status TEXT DEFAULT 'PENDING',
  paymentUrl TEXT,
  qrUrl TEXT,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_username ON payments(username);

-- 4. TABEL PENARIKAN DANA (WITHDRAWALS)
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  transactionId TEXT,
  clientRequestId TEXT,
  username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  fullname TEXT,
  destination TEXT,
  method TEXT,
  amount BIGINT DEFAULT 0,
  adminFee BIGINT DEFAULT 0,
  totalDeducted BIGINT DEFAULT 0,
  orderId TEXT,
  merchant TEXT,
  status TEXT,
  gatewayStatus TEXT,
  type TEXT,
  balanceRefunded INT DEFAULT 0,
  apiMessage TEXT,
  failureReason TEXT,
  rawResponse TEXT,
  createdAt TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_username ON withdrawals(username);
CREATE INDEX IF NOT EXISTS idx_withdrawals_clientreq ON withdrawals(clientRequestId);

-- 5. TABEL BANNER PROMOSI (BANNERS)
CREATE TABLE IF NOT EXISTS banners (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  imageUrl TEXT NOT NULL,
  link TEXT,
  active INT DEFAULT 1,
  createdAt TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABEL INFORMASI / PENGUMUMAN (INFORMATIONS)
CREATE TABLE IF NOT EXISTS informations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  contentTitle TEXT,
  content TEXT NOT NULL,
  date TEXT,
  time TEXT,
  active INT DEFAULT 1,
  createdAt TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TABEL PENGATURAN PRODUK PPOB (PPOB_VISIBILITY)
CREATE TABLE IF NOT EXISTS ppob_visibility (
  sku TEXT PRIMARY KEY,
  active INT DEFAULT 1,
  category TEXT,
  brand TEXT,
  markup BIGINT DEFAULT 0,
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);

-- 8. TABEL PESAN CHAT CS (CHAT_MESSAGES)
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL,
  sender TEXT NOT NULL,
  senderName TEXT,
  message TEXT NOT NULL,
  readStatus INT DEFAULT 0,
  createdAt TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_conversation ON chat_messages(conversationId);

-- 9. TABEL KONFIGURASI APLIKASI (APP_CONFIG)
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);

-- 10. TABEL LOKASI PENGGUNA (USER_LOCATIONS)
CREATE TABLE IF NOT EXISTS user_locations (
  deviceId TEXT PRIMARY KEY,
  username TEXT,
  fullname TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  ip TEXT,
  deviceModel TEXT,
  deviceType TEXT,
  os TEXT,
  browser TEXT,
  locationName TEXT,
  isAppInstall INT DEFAULT 1,
  lastSeen TIMESTAMPTZ DEFAULT NOW(),
  createdAt TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_locations_lastseen ON user_locations(lastSeen DESC);

-- 11. TABEL ADMIN (ADMIN_USERS)
CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  fullname TEXT DEFAULT 'Administrator',
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);

-- 12. TABEL PUSH NOTIFIKASI (PUSH_SUBSCRIPTIONS)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  username TEXT,
  subscriptionData TEXT,
  createdAt TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- PENGISIAN DATA AWAL (SEED DATA YANG DIBUTUHKAN SISTEM)
-- ==============================================================================

-- 1. AKUN ADMIN UTAMA
INSERT INTO admin_users (username, password, fullname)
VALUES ('andika123', 'andika123', 'Administrator Utama')
ON CONFLICT (username) DO NOTHING;

-- 2. AKUN PENGGUNA TESTER (Opsional untuk login/uji coba awal)
INSERT INTO users (username, password, fullname, brand, userId, waContact, email, mainBalance, role, transactionPin)
VALUES ('demo123', 'demo123', 'Pengguna Demo', 'Noxaria', 'USR-001', '08123456789', 'demo@noxarianet.my.id', 50000, 'MEMBER', '123456')
ON CONFLICT (username) DO NOTHING;

-- 3. KONFIGURASI APLIKASI & RUNNING TEXT
INSERT INTO app_config (key, value)
VALUES 
  ('announcement', '{"text":"Selamat datang di Noxaria Wallet! Sistem transaksi otomatis 24 jam nonstop siap melayani Anda.","active":true}'),
  ('appUpdate', '{"version":"1.0.0","notes":"Versi rilis stabil","forceUpdate":false}'),
  ('global_ppob_markup', '1000')
ON CONFLICT (key) DO NOTHING;

-- 4. BANNER PROMO UTAMA (SLIDER BERANDA)
INSERT INTO banners (id, title, imageUrl, link, active)
VALUES 
  ('BAN-01', 'Deposit Otomatis QRIS Real-Time', 'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=800&auto=format&fit=crop&q=60', '', 1),
  ('BAN-02', 'Layanan Transaksi PPOB & Game 24 Jam', 'https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=800&auto=format&fit=crop&q=60', '', 1)
ON CONFLICT (id) DO NOTHING;

-- 5. INFORMASI & PENGUMUMAN APLIKASI
INSERT INTO informations (id, title, contentTitle, content, date, time, active)
VALUES 
  ('INF-01', 'Selamat Datang', 'Layanan Resmi Noxaria Wallet', 'Nikmati kemudahan bertransaksi produk digital PPOB, pulsa, game, dan transfer saldo antar pengguna dengan aman dan cepat.', '25 Okt 2026', '22:00 WIB', 1)
ON CONFLICT (id) DO NOTHING;

-- ==============================================================================
-- NONAKTIFKAN ROW LEVEL SECURITY (RLS)
-- (Agar Backend Node.js dapat membaca & menulis data langsung tanpa izin rumit)
-- ==============================================================================
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals DISABLE ROW LEVEL SECURITY;
ALTER TABLE banners DISABLE ROW LEVEL SECURITY;
ALTER TABLE informations DISABLE ROW LEVEL SECURITY;
ALTER TABLE ppob_visibility DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions DISABLE ROW LEVEL SECURITY;
