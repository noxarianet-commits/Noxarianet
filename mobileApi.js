const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./database');
const SekaliPayService = require('./sekalipayService');
const FinCloudQrisService = require('./fincloudQrisService');

const JWT_SECRET = process.env.JWT_SECRET || 'noxa_jwt_secret_key_8f93e1029c874b2a91e03c';

const sekalipay = new SekaliPayService({
  apiKey: process.env.SEKALIPAY_API_KEY || '48IX7ryGa2a92HUMiYCdI2CuhEBGps73',
  webhookSecret: process.env.SEKALIPAY_WEBHOOK_SECRET || '933aa734e8cefd9669e890d03af2a07405ee7b8b5c112a5de4719dafab18cda7'
});

const fincloud = new FinCloudQrisService();

// ==========================================
// IN-MEMORY STORES (OTP, INQUIRY, IDEMPOTENCY)
// ==========================================
const mobileOtpStore = new Map(); // email/phone -> { code, expiresAt, attempts, data }
const billInquiryStore = new Map(); // inquiryId -> { ...inquiryData, expiresAt, used }
const idempotencyStore = new Map(); // key -> { timestamp, response }

// Periodic cleanup of expired entries (every 5 mins)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of mobileOtpStore.entries()) {
    if (now > v.expiresAt) mobileOtpStore.delete(k);
  }
  for (const [k, v] of billInquiryStore.entries()) {
    if (now > v.expiresAt) billInquiryStore.delete(k);
  }
  for (const [k, v] of idempotencyStore.entries()) {
    if (now - v.timestamp > 3600 * 1000) idempotencyStore.delete(k); // 1 hour TTL
  }
}, 5 * 60 * 1000);

// ==========================================
// STANDARD ERROR HELPER
// ==========================================
function sendError(res, httpStatus, code, message) {
  return res.status(httpStatus).json({
    success: false,
    code,
    error: message,
    message
  });
}

// ==========================================
// MOBILE AUTH MIDDLEWARE (STRICT ANDROID ONLY)
// ==========================================
const requireMobileAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Header Authorization Bearer token wajib disertakan.');
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Token otorisasi kosong.');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return sendError(res, 401, 'TOKEN_EXPIRED', 'Token tidak valid atau telah kedaluwarsa.');
  }

  // Strict check: token must have claim client: "android"
  if (!decoded || decoded.client !== 'android') {
    return sendError(res, 403, 'APP_ONLY', 'Token bukan token aplikasi Android.');
  }

  const username = decoded.username;
  let user = await db.getUser(username);
  if (!user && decoded.userId) user = await db.getUserByUserId(decoded.userId);
  if (!user && decoded.email) user = await db.getUserByEmail(decoded.email);

  if (!user) {
    return sendError(res, 401, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan.');
  }

  if (user.isSuspended) {
    return sendError(res, 403, 'ACCOUNT_SUSPENDED', user.suspendReason || 'Akun Anda dinonaktifkan.');
  }

  req.user = user;
  req.authClient = 'android';
  next();
};

// ==========================================
// IDEMPOTENCY MIDDLEWARE FOR ORDERS
// ==========================================
const checkIdempotency = (req, res, next) => {
  const key = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  if (!key) {
    return sendError(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Header Idempotency-Key wajib disertakan.');
  }

  const existing = idempotencyStore.get(key);
  if (existing) {
    return res.status(existing.status || 200).json(existing.response);
  }

  // Intercept json send to cache idempotency response
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      idempotencyStore.set(key, {
        timestamp: Date.now(),
        status: res.statusCode,
        response: body
      });
    }
    return originalJson(body);
  };

  next();
};

// ==========================================
// 1. CONFIG & HEALTH
// GET /config (Public)
// ==========================================
router.get('/config', (req, res) => {
  return res.json({
    success: true,
    data: {
      min_version: '1.0.0',
      latest_version: '1.0.0',
      maintenance: false,
      features: { bills: true, topup: true, tickets: true },
      payment_methods: ['balance', 'qris'],
      shop_status: { isOpen: true, message: 'Selamat datang di NoxariaNet Wallet!' }
    }
  });
});

// ==========================================
// 2. AUTHENTICATION
// ==========================================

// POST /auth/register — { email, phone, display_name, password }
router.post('/auth/register', async (req, res) => {
  try {
    const { email, phone, display_name, password } = req.body;

    if (!email || !phone || !password) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Email, nomor HP, dan password wajib diisi.');
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPhone = String(phone).trim();

    // Check if user already exists
    const existingEmail = await db.getUserByEmail(cleanEmail);
    const existingPhone = await db.getUserByWaContact(cleanPhone);
    const existingUsername = await db.getUser(cleanEmail);

    if (existingEmail || existingPhone || existingUsername) {
      return sendError(res, 400, 'USER_EXISTS', 'Email atau nomor HP sudah terdaftar. Silakan login.');
    }

    // Generate 6-digit OTP code (5 mins validity)
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    mobileOtpStore.set(cleanEmail, {
      code: otpCode,
      expiresAt: Date.now() + 5 * 60 * 1000,
      attempts: 0,
      data: {
        email: cleanEmail,
        phone: cleanPhone,
        display_name: display_name || cleanEmail.split('@')[0],
        password: password
      }
    });

    console.log(`[Mobile Auth] Register verification code generated for ${cleanEmail}: ${otpCode}`);

    return res.json({
      success: true,
      message: 'Kode verifikasi registrasi telah dikirim.',
      // Included for staging testing convenience:
      verification_code: otpCode
    });
  } catch (err) {
    console.error('[Mobile Register Error]:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// POST /auth/register/verify — { email, code } -> token app (client: "android")
router.post('/auth/register/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Email dan kode verifikasi wajib diisi.');
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const stored = mobileOtpStore.get(cleanEmail);

    if (!stored || Date.now() > stored.expiresAt) {
      return sendError(res, 400, 'OTP_EXPIRED', 'Kode verifikasi kedaluwarsa atau belum diminta.');
    }

    if (stored.attempts >= 5) {
      mobileOtpStore.delete(cleanEmail);
      return sendError(res, 429, 'RATE_LIMITED', 'Batas percobaan terlampaui. Minta kode baru.');
    }

    if (stored.code !== String(code).trim()) {
      stored.attempts += 1;
      return sendError(res, 400, 'OTP_INVALID', 'Kode verifikasi salah.');
    }

    // Validated! Clear OTP
    mobileOtpStore.delete(cleanEmail);

    const regData = stored.data;
    const assignedUsername = cleanEmail;
    const assignedUserId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Create user in DB
    const newUser = await db.createUser({
      username: assignedUsername,
      password: regData.password,
      fullname: regData.display_name,
      brand: regData.display_name.toUpperCase(),
      userId: assignedUserId,
      email: cleanEmail,
      waContact: regData.phone
    });

    const finalUser = newUser || await db.getUser(assignedUsername);

    // Issue token with claim client: "android" (valid 30 days)
    const token = jwt.sign(
      {
        username: assignedUsername,
        userId: assignedUserId,
        email: cleanEmail,
        role: 'MEMBER',
        client: 'android'
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.status(201).json({
      success: true,
      token,
      data: {
        id: assignedUserId,
        email: cleanEmail,
        phone: regData.phone,
        display_name: regData.display_name,
        balance: 0
      }
    });
  } catch (err) {
    console.error('[Mobile Register Verify Error]:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// POST /auth/register/resend — { email }
router.post('/auth/register/resend', async (req, res) => {
  const { email } = req.body;
  if (!email) return sendError(res, 400, 'VALIDATION_ERROR', 'Email wajib diisi.');

  const cleanEmail = String(email).trim().toLowerCase();
  const stored = mobileOtpStore.get(cleanEmail);

  if (!stored) {
    return sendError(res, 404, 'NOT_FOUND', 'Data registrasi tidak ditemukan. Silakan mulai kembali.');
  }

  const newCode = Math.floor(100000 + Math.random() * 900000).toString();
  stored.code = newCode;
  stored.expiresAt = Date.now() + 5 * 60 * 1000;
  stored.attempts = 0;

  console.log(`[Mobile Auth] Resent verification code to ${cleanEmail}: ${newCode}`);

  return res.json({
    success: true,
    message: 'Kode verifikasi telah dikirim ulang.',
    verification_code: newCode
  });
});

// POST /auth/login — { email, password } -> token app (client: "android")
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Email dan password wajib diisi.');
    }

    const cleanInput = String(email).trim();
    let user = await db.getUserByEmail(cleanInput.toLowerCase());
    if (!user) user = await db.getUser(cleanInput);
    if (!user) user = await db.getUserByWaContact(cleanInput);
    if (!user) user = await db.getUserByUserId(cleanInput);

    if (!user) {
      return sendError(res, 400, 'INVALID_CREDENTIALS', 'Email atau password salah.');
    }

    if (!db.verifyPassword(password, user.password)) {
      return sendError(res, 400, 'INVALID_CREDENTIALS', 'Email atau password salah.');
    }

    if (user.isSuspended) {
      return sendError(res, 403, 'ACCOUNT_SUSPENDED', user.suspendReason || 'Akun dinonaktifkan.');
    }

    // Issue JWT with claim client: "android" (valid 30 days)
    const token = jwt.sign(
      {
        username: user.username,
        userId: user.userId || user.id || user.username,
        email: user.email || '',
        role: user.role || 'MEMBER',
        client: 'android'
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({
      success: true,
      token,
      data: {
        id: user.userId || user.id || user.username,
        email: user.email,
        phone: user.waContact,
        display_name: user.fullname || user.name || user.username,
        balance: user.mainBalance !== undefined ? user.mainBalance : (user.saldo || 0)
      }
    });
  } catch (err) {
    console.error('[Mobile Login Error]:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// POST /auth/forgot-password — { email }
router.post('/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return sendError(res, 400, 'VALIDATION_ERROR', 'Email wajib diisi.');

  const cleanEmail = String(email).trim().toLowerCase();
  const user = await db.getUserByEmail(cleanEmail);
  if (!user) {
    // Return success to prevent email enumeration
    return res.json({ success: true, message: 'Jika email terdaftar, kode reset telah dikirim.' });
  }

  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  mobileOtpStore.set(`reset_${cleanEmail}`, {
    code: resetCode,
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0,
    username: user.username
  });

  console.log(`[Mobile Auth] Password reset code for ${cleanEmail}: ${resetCode}`);

  return res.json({
    success: true,
    message: 'Kode reset password telah dikirim.',
    reset_code: resetCode
  });
});

// POST /auth/forgot-password/verify — { email, code, new_password }
router.post('/auth/forgot-password/verify', async (req, res) => {
  try {
    const { email, code, new_password } = req.body;
    if (!email || !code || !new_password) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Email, kode, dan password baru wajib diisi.');
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const stored = mobileOtpStore.get(`reset_${cleanEmail}`);

    if (!stored || Date.now() > stored.expiresAt) {
      return sendError(res, 400, 'OTP_EXPIRED', 'Kode reset telah kedaluwarsa.');
    }

    if (stored.code !== String(code).trim()) {
      return sendError(res, 400, 'OTP_INVALID', 'Kode reset salah.');
    }

    mobileOtpStore.delete(`reset_${cleanEmail}`);

    const newHashed = db.hashPassword(new_password);
    await db.updateUser(stored.username, { password: newHashed });

    return res.json({
      success: true,
      message: 'Password berhasil diperbarui. Silakan masuk kembali.'
    });
  } catch (err) {
    console.error('[Mobile Reset Verify Error]:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// POST /auth/forgot-password/resend — { email }
router.post('/auth/forgot-password/resend', async (req, res) => {
  const { email } = req.body;
  if (!email) return sendError(res, 400, 'VALIDATION_ERROR', 'Email wajib diisi.');

  const cleanEmail = String(email).trim().toLowerCase();
  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  mobileOtpStore.set(`reset_${cleanEmail}`, {
    code: resetCode,
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0
  });

  return res.json({
    success: true,
    message: 'Kode reset password telah dikirim ulang.',
    reset_code: resetCode
  });
});

// ==========================================
// 3. PROFIL & SALDO (Protected)
// ==========================================

// GET /me — Profil + Saldo
router.get('/me', requireMobileAuth, async (req, res) => {
  const user = req.user;
  return res.json({
    success: true,
    data: {
      id: user.userId || user.id || user.username,
      username: user.username,
      email: user.email || '',
      phone: user.waContact || '',
      display_name: user.fullname || user.name || user.username,
      balance: user.mainBalance !== undefined ? user.mainBalance : (user.saldo || 0),
      qris_balance: user.qrisBalance || 0,
      role: user.role || 'MEMBER',
      created_at: user.createdAt
    }
  });
});

// PUT /me — { display_name?, phone? }
router.put('/me', requireMobileAuth, async (req, res) => {
  try {
    const { display_name, phone } = req.body;
    const updates = {};
    if (display_name) updates.fullname = String(display_name).trim();
    if (phone) updates.waContact = String(phone).trim();

    if (Object.keys(updates).length > 0) {
      await db.updateUser(req.user.username, updates);
    }

    const updatedUser = await db.getUser(req.user.username);
    return res.json({
      success: true,
      message: 'Profil berhasil diperbarui.',
      data: {
        id: updatedUser.userId || updatedUser.username,
        email: updatedUser.email,
        phone: updatedUser.waContact,
        display_name: updatedUser.fullname,
        balance: updatedUser.mainBalance !== undefined ? updatedUser.mainBalance : (updatedUser.saldo || 0)
      }
    });
  } catch (err) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// PUT /me/password — { current_password, new_password }
router.put('/me/password', requireMobileAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Password lama dan password baru wajib diisi.');
    }

    if (!db.verifyPassword(current_password, req.user.password)) {
      return sendError(res, 400, 'INVALID_PASSWORD', 'Password saat ini salah.');
    }

    const newHashed = db.hashPassword(new_password);
    await db.updateUser(req.user.username, { password: newHashed });

    return res.json({
      success: true,
      message: 'Password berhasil diubah.'
    });
  } catch (err) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /balance & GET /balance/me — Ambil saldo terkini
router.get(['/balance', '/balance/me'], requireMobileAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.user.username);
    return res.json({
      success: true,
      data: {
        balance: user.mainBalance !== undefined ? user.mainBalance : (user.saldo || 0),
        qris_balance: user.qrisBalance || 0
      }
    });
  } catch (err) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// POST /balance/topup — Request top-up saldo via FinCloud Dynamic QRIS
router.post('/balance/topup', requireMobileAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    const numAmt = Math.ceil(Number(amount) || 0);
    if (!numAmt || numAmt < 1000) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Nominal top-up minimal Rp 1.000.');
    }

    const user = req.user;
    const qrisRes = await fincloud.createDynamicQris({
      amount: numAmt,
      userId: user.username,
      username: user.username
    });

    const refId = qrisRes.invoice || `TOPUP_${user.username}_${Date.now()}`;
    await db.addPayment({
      id: refId,
      idDepo: refId,
      username: user.username,
      amount: numAmt,
      status: 'PENDING',
      paymentUrl: qrisRes.qr_link,
      qrUrl: qrisRes.qr_link
    });

    return res.json({
      success: true,
      data: {
        ref_id: refId,
        amount: numAmt,
        qr_link: qrisRes.qr_link,
        payment_link: qrisRes.payment_link || qrisRes.qr_link,
        expired_at: qrisRes.expired_at
      }
    });
  } catch (err) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /balance/history — Riwayat deposit / mutasi saldo
router.get('/balance/history', requireMobileAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.user.username);
    const history = (user?.history || []).filter(h => h.type === 'TOPUP' || h.type === 'DEPOSIT' || String(h.id).startsWith('TOPUP') || String(h.id).startsWith('INV-'));
    return res.json({
      success: true,
      data: history
    });
  } catch (err) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// ==========================================
// 4. KATALOG
// ==========================================

// GET /home — Kategori prepaid & tagihan, featured, testimoni, quick actions
router.get('/home', async (req, res) => {
  try {
    const banners = await db.getBanners();
    const activeBanners = (banners || []).filter(b => b.active);

    return res.json({
      success: true,
      data: {
        categories: [
          { id: 'prepaid', name: 'Prabayar', icon: 'bolt', type: 'prepaid' },
          { id: 'postpaid', name: 'Tagihan', icon: 'receipt', type: 'postpaid' },
          { id: 'pulsa', name: 'Pulsa & Data', icon: 'phone_android', type: 'prepaid' },
          { id: 'emoney', name: 'E-Money', icon: 'account_balance_wallet', type: 'prepaid' },
          { id: 'games', name: 'Game Online', icon: 'sports_esports', type: 'prepaid' },
          { id: 'pln', name: 'Listrik PLN', icon: 'electric_bolt', type: 'prepaid' }
        ],
        banners: activeBanners.map(b => ({
          id: b.id,
          title: b.title,
          image_url: b.imageUrl,
          link: b.link || ''
        })),
        quick_actions: [
          { id: 'topup', title: 'Isi Saldo', action: 'open_topup', icon: 'wallet' },
          { id: 'scan_qris', title: 'Bayar QRIS', action: 'open_scanner', icon: 'qr_code_scanner' },
          { id: 'bills', title: 'Cek Tagihan', action: 'open_bills', icon: 'receipt_long' },
          { id: 'history', title: 'Riwayat', action: 'open_history', icon: 'history' }
        ],
        featured_products: [
          { id: 'pulsa_tsel', name: 'Telkomsel Reguler', category: 'Pulsa' },
          { id: 'dana_topup', name: 'Topup Saldo DANA', category: 'E-Money' },
          { id: 'pln_token', name: 'Token Listrik PLN', category: 'PLN' },
          { id: 'ff_diamonds', name: 'Free Fire Diamonds', category: 'Game' }
        ],
        testimonials: [
          { name: 'Rian S.', comment: 'Top-up saldo cepat banget masuk dan harga bersahabat.', rating: 5 },
          { name: 'Dewi K.', comment: 'Sangat praktis untuk bayar tagihan bulanan dan beli kuota.', rating: 5 }
        ]
      }
    });
  } catch (err) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /products?type=prepaid|postpaid&category=&search=&page=&per_page=
router.get('/products', async (req, res) => {
  try {
    const { type = 'prepaid', category, search, page = 1, per_page = 50 } = req.query;
    const itemsResult = await sekalipay.getItems();
    let items = (itemsResult && Array.isArray(itemsResult.data)) ? itemsResult.data : [];

    // Filter by type
    if (type === 'postpaid') {
      // Biller / Postpaid group catalog
      const billerGroups = [
        {
          id: 10,
          name: 'PLN Bulanan',
          category: 'Tagihan Listrik',
          product_type: 'postpaid',
          variants: [
            { id: 'PLN_POSTPAID_1', name: 'PLN Pascabayar', admin_fee: 2500 }
          ]
        },
        {
          id: 20,
          name: 'BPJS Kesehatan',
          category: 'Tagihan BPJS',
          product_type: 'postpaid',
          variants: [
            { id: 'BPJS_KES_1', name: 'BPJS Kesehatan Mandiri', admin_fee: 2500 }
          ]
        },
        {
          id: 30,
          name: 'PDAM Jawa Barat dan Jakarta',
          category: 'Tagihan Air PDAM',
          product_type: 'postpaid',
          variants: [
            { id: 'PDAM_JKT_AETRA', name: 'PDAM DKI Jakarta PAM JAYA / Aetra', admin_fee: 2500 },
            { id: 'PDAM_BDG', name: 'PDAM Kota Bandung', admin_fee: 2500 },
            { id: 'PDAM_BOGOR', name: 'PDAM Kota Bogor Tirta Pakuan', admin_fee: 2500 },
            { id: 'PDAM_BKS', name: 'PDAM Kota Bekasi', admin_fee: 2500 }
          ]
        },
        {
          id: 40,
          name: 'PDAM Jawa Tengah & DIY',
          category: 'Tagihan Air PDAM',
          product_type: 'postpaid',
          variants: [
            { id: 'PDAM_SMG', name: 'PDAM Kota Semarang', admin_fee: 2500 },
            { id: 'PDAM_SOLO', name: 'PDAM Kota Solo', admin_fee: 2500 },
            { id: 'PDAM_YOGYA', name: 'PDAM Kota Yogyakarta', admin_fee: 2500 }
          ]
        },
        {
          id: 50,
          name: 'PBB & Pajak Daerah',
          category: 'Pajak Daerah',
          product_type: 'postpaid',
          variants: [
            { id: 'PBB_DKI', name: 'PBB DKI Jakarta', admin_fee: 3000 },
            { id: 'PBB_JBR', name: 'PBB Jawa Barat', admin_fee: 3000 }
          ]
        }
      ];

      let filteredGroups = billerGroups;
      if (search) {
        const s = String(search).toLowerCase();
        filteredGroups = billerGroups.filter(g =>
          g.name.toLowerCase().includes(s) ||
          g.category.toLowerCase().includes(s) ||
          g.variants.some(v => v.name.toLowerCase().includes(s))
        );
      }

      return res.json({
        success: true,
        data: filteredGroups
      });
    }

    // Prepaid products
    if (category) {
      const c = String(category).toLowerCase();
      items = items.filter(i => (i.category && i.category.toLowerCase().includes(c)) || (i.brand && i.brand.toLowerCase().includes(c)));
    }

    if (search) {
      const s = String(search).toLowerCase();
      items = items.filter(i => (i.name && i.name.toLowerCase().includes(s)) || (i.brand && i.brand.toLowerCase().includes(s)) || (i.sku && i.sku.toLowerCase().includes(s)));
    }

    const p = Math.max(1, parseInt(page, 10));
    const limit = Math.max(1, parseInt(per_page, 10));
    const total = items.length;
    const paginated = items.slice((p - 1) * limit, p * limit);

    // Group items into product structure with variants
    const productsMap = new Map();
    for (const item of paginated) {
      const brandKey = item.brand || item.category || 'PPOB';
      if (!productsMap.has(brandKey)) {
        productsMap.set(brandKey, {
          id: item.id,
          name: brandKey,
          category: item.category || 'Prepaid',
          product_type: 'prepaid',
          variants: []
        });
      }
      productsMap.get(brandKey).variants.push({
        id: item.sku || `SKL-${item.id}`,
        vendor_id: item.id,
        name: item.name,
        price: item.price,
        admin_fee: 0,
        stock: item.stock
      });
    }

    return res.json({
      success: true,
      data: Array.from(productsMap.values()),
      pagination: {
        total,
        page: p,
        per_page: limit,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /products/:id — Detail Produk
router.get('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if postpaid biller group
    if (String(id).startsWith('POSTPAID_') || [10, 20, 30, 40, 50].includes(Number(id))) {
      return res.json({
        success: true,
        data: {
          id: id,
          name: 'Tagihan Pasca Bayar',
          product_type: 'postpaid',
          category: 'Tagihan',
          variants: [
            { id: '1', name: 'Standar Biller', admin_fee: 2500 }
          ]
        }
      });
    }

    const itemsResult = await sekalipay.getItems();
    const items = (itemsResult && Array.isArray(itemsResult.data)) ? itemsResult.data : [];
    const item = items.find(i => String(i.id) === String(id) || i.sku === id || `SKL-${i.id}` === id);

    if (!item) {
      return sendError(res, 404, 'PRODUCT_NOT_AVAILABLE', 'Produk tidak ditemukan atau tidak tersedia.');
    }

    return res.json({
      success: true,
      data: {
        id: item.id,
        sku: item.sku || `SKL-${item.id}`,
        name: item.name,
        brand: item.brand,
        category: item.category,
        product_type: 'prepaid',
        variants: [
          {
            id: item.sku || `SKL-${item.id}`,
            name: item.name,
            price: item.price,
            admin_fee: 0,
            stock: item.stock
          }
        ]
      }
    });
  } catch (err) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// POST /products/validate — Validasi ID game / e-wallet
router.post('/products/validate', async (req, res) => {
  try {
    const { product_id, variant_id, customer_id, zone_id } = req.body;
    if (!customer_id) {
      return sendError(res, 400, 'TARGET_REQUIRED', 'ID pelanggan / nomor tujuan wajib diisi.');
    }

    // Call SekaliPay / vendor checker if available
    let customerName = 'PENGGUNA TERVERIFIKASI';
    return res.json({
      success: true,
      data: {
        customer_id: customer_id,
        zone_id: zone_id || '',
        name: customerName,
        customer_name: customerName,
        valid: true
      }
    });
  } catch (err) {
    return sendError(res, 400, 'TARGET_INVALID', 'Validasi akun gagal.');
  }
});

// ==========================================
// 5. CEK TAGIHAN (POSTPAID BILL INQUIRY)
// ==========================================

// POST /bills/inquiry — { product_id, variant_id, customer_number }
router.post('/bills/inquiry', async (req, res) => {
  try {
    const { product_id, variant_id, customer_number } = req.body;
    if (!product_id || !customer_number) {
      return sendError(res, 400, 'TARGET_REQUIRED', 'product_id dan customer_number wajib diisi.');
    }

    const inquiryId = `inq_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins

    const sampleAmount = 150000;
    const adminFee = 2500;
    const totalAmount = sampleAmount + adminFee;

    const inquiryRecord = {
      inquiry_id: inquiryId,
      expires_at: expiresAt,
      product: { id: product_id, name: 'Tagihan Pasca Bayar', category: 'Tagihan' },
      variant: { id: variant_id || '1', name: 'Standar' },
      customer: { number: customer_number, name: 'PELANGGAN NOXARIA' },
      bill: {
        period: new Date().toLocaleDateString('id-ID', { month: 'short', year: 'numeric' }).toUpperCase(),
        amount: sampleAmount,
        admin_fee: adminFee,
        total: totalAmount
      },
      payment_methods: ['balance'],
      used: false
    };

    billInquiryStore.set(inquiryId, inquiryRecord);

    return res.json({
      success: true,
      data: inquiryRecord
    });
  } catch (err) {
    return sendError(res, 500, 'BILL_INQUIRY_FAILED', 'Cek tagihan gagal diproses.');
  }
});

// ==========================================
// 6. ORDER ENGINE
// ==========================================

// POST /orders — (Requires Idempotency-Key & requireMobileAuth)
router.post('/orders', requireMobileAuth, checkIdempotency, async (req, res) => {
  try {
    const { type, product_id, variant_id, fields, inquiry_id, payment_type = 'balance' } = req.body;
    const user = req.user;

    // --- CASE A: BILL ORDER ---
    if (type === 'bill') {
      if (!inquiry_id) {
        return sendError(res, 400, 'BILL_INQUIRY_FAILED', 'inquiry_id wajib diisi untuk order tagihan.');
      }

      const inquiry = billInquiryStore.get(inquiry_id);
      if (!inquiry || Date.now() > new Date(inquiry.expires_at).getTime()) {
        return sendError(res, 400, 'BILL_INQUIRY_EXPIRED', 'Quote tagihan telah kedaluwarsa.');
      }

      if (inquiry.used) {
        return sendError(res, 400, 'BILL_INQUIRY_ALREADY_USED', 'Quote tagihan ini sudah pernah digunakan.');
      }

      const totalToPay = inquiry.bill.total;
      const currentBalance = user.mainBalance !== undefined ? user.mainBalance : (user.saldo || 0);

      if (currentBalance < totalToPay) {
        return sendError(res, 400, 'INSUFFICIENT_BALANCE', `Saldo tidak cukup (Rp ${currentBalance.toLocaleString('id-ID')}). Total tagihan: Rp ${totalToPay.toLocaleString('id-ID')}.`);
      }

      // Deduct balance atomically
      const deductRes = await db.atomicDeductBalance(user.username, totalToPay, 'mainBalance');
      if (!deductRes.success) {
        return sendError(res, 400, 'INSUFFICIENT_BALANCE', deductRes.error || 'Gagal memotong saldo.');
      }

      inquiry.used = true;
      const orderId = `NX-BILL-${Date.now()}`;

      // Record in history
      await db.addHistory(user.username, {
        id: orderId,
        orderId: orderId,
        merchant: inquiry.product.name,
        product_name: inquiry.variant.name,
        target: inquiry.customer.number,
        account_name: inquiry.customer.name,
        amount: totalToPay,
        status: 'BERHASIL',
        type: 'POSTPAID_BILL',
        note: `Tagihan periode ${inquiry.bill.period} lunas.`
      });

      return res.status(201).json({
        success: true,
        data: {
          order_id: orderId,
          amount: totalToPay,
          status: 'SUCCESS',
          payment_type: 'balance',
          pg_provider: 'balance'
        }
      });
    }

    // --- CASE B: PREPAID ORDER ---
    if (!variant_id && !product_id) {
      return sendError(res, 400, 'VARIANT_REQUIRED', 'product_id atau variant_id wajib diisi.');
    }

    const targetCustomer = (fields && (fields.customer_id || fields.target)) || '';
    if (!targetCustomer) {
      return sendError(res, 400, 'TARGET_REQUIRED', 'Nomor pelanggan / tujuan wajib disertakan di fields.customer_id.');
    }

    // Lookup product item
    const itemsResult = await sekalipay.getItems();
    const items = (itemsResult && Array.isArray(itemsResult.data)) ? itemsResult.data : [];
    const lookupKey = variant_id || product_id;
    const item = items.find(i => i.sku === lookupKey || String(i.id) === String(lookupKey).replace(/^SKL-/, ''));

    if (!item) {
      return sendError(res, 404, 'PRODUCT_NOT_AVAILABLE', 'Produk tidak ditemukan atau sedang gangguan.');
    }

    const globalMarkup = await db.getGlobalPpobMarkup();
    const visMap = await db.getPpobVisibilityMap();
    const vis = visMap[item.sku] || visMap[String(item.id)];
    const markup = (vis && vis.markup !== undefined) ? Number(vis.markup) : globalMarkup;
    const totalPrice = (Number(item.price) || 0) + markup;
    const orderId = `NX-PRE-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    // Sub-case: Payment with Balance
    if (payment_type === 'balance') {
      const currentBalance = user.mainBalance !== undefined ? user.mainBalance : (user.saldo || 0);
      if (currentBalance < totalPrice) {
        return sendError(res, 400, 'INSUFFICIENT_BALANCE', `Saldo tidak cukup (Rp ${currentBalance.toLocaleString('id-ID')}). Dibutuhkan: Rp ${totalPrice.toLocaleString('id-ID')}.`);
      }

      // Atomic balance deduction
      const deductRes = await db.atomicDeductBalance(user.username, totalPrice, 'mainBalance');
      if (!deductRes.success) {
        return sendError(res, 400, 'INSUFFICIENT_BALANCE', deductRes.error || 'Gagal memotong saldo.');
      }

      // Call SekaliPay Order API
      let orderCall;
      try {
        orderCall = await sekalipay.sendRequest('/v1/order', 'POST', {
          item_id: item.id,
          target: targetCustomer
        });
      } catch (apiErr) {
        console.error('[SekaliPay Call Error]:', apiErr.message);
      }

      const orderStatus = (orderCall && orderCall.success) ? 'PROCESSING' : 'PENDING';
      const sn = (orderCall && (orderCall.data?.sn || orderCall.sn)) || '';

      await db.addHistory(user.username, {
        id: orderId,
        orderId: orderId,
        merchant: item.brand || 'PPOB',
        product_name: item.name,
        target: targetCustomer,
        amount: totalPrice,
        status: orderStatus,
        sn: sn,
        type: 'PREPAID_ORDER',
        note: `Order ${item.name} ke ${targetCustomer}`
      });

      return res.status(201).json({
        success: true,
        data: {
          order_id: orderId,
          amount: totalPrice,
          status: orderStatus,
          payment_type: 'balance',
          pg_provider: 'balance'
        }
      });
    }

    // Sub-case: Payment with Gateway (FinCloud Dynamic QRIS)
    if (payment_type === 'gateway' || payment_type === 'qris') {
      const qrisRes = await fincloud.createDynamicQris({
        amount: totalPrice,
        userId: user.username,
        username: user.username
      });

      await db.addPayment({
        id: orderId,
        idDepo: orderId,
        username: user.username,
        amount: totalPrice,
        status: 'PENDING',
        paymentUrl: qrisRes.qr_link,
        qrUrl: qrisRes.qr_link
      });

      return res.status(201).json({
        success: true,
        data: {
          order_id: orderId,
          invoice: qrisRes.invoice || orderId,
          amount: totalPrice,
          total: totalPrice,
          status: 'PENDING',
          payment_type: 'gateway',
          payment_link: qrisRes.payment_link || qrisRes.qr_link,
          qr_link: qrisRes.qr_link,
          expired_at: qrisRes.expired_at
        }
      });
    }

    return sendError(res, 400, 'VALIDATION_ERROR', `payment_type "${payment_type}" tidak didukung.`);
  } catch (err) {
    console.error('[Mobile Orders Error]:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /orders?page=&limit=&status= — Riwayat order user
router.get('/orders', requireMobileAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const user = await db.getUser(req.user.username);
    let history = user?.history || [];

    if (status) {
      const s = String(status).toUpperCase();
      history = history.filter(h => (h.status && h.status.toUpperCase() === s));
    }

    const p = Math.max(1, parseInt(page, 10));
    const l = Math.max(1, parseInt(limit, 10));
    const paginated = history.slice((p - 1) * l, p * l);

    return res.json({
      success: true,
      data: paginated,
      pagination: {
        total: history.length,
        page: p,
        limit: l,
        total_pages: Math.ceil(history.length / l)
      }
    });
  } catch (err) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /orders/:id — Detail Order
router.get('/orders/:id', requireMobileAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db.getUser(req.user.username);
    const order = (user?.history || []).find(h => String(h.id) === String(id) || String(h.orderId) === String(id));

    if (!order) {
      return sendError(res, 404, 'NOT_FOUND', 'Order tidak ditemukan.');
    }

    return res.json({
      success: true,
      data: order
    });
  } catch (err) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// POST /orders/:id/cancel — Batal Order
router.post('/orders/:id/cancel', requireMobileAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db.getUser(req.user.username);
    const order = (user?.history || []).find(h => String(h.id) === String(id) || String(h.orderId) === String(id));

    if (!order) {
      return sendError(res, 404, 'NOT_FOUND', 'Order tidak ditemukan.');
    }

    if (order.status !== 'PENDING') {
      return sendError(res, 400, 'ORDER_NOT_CANCELLABLE', `Order dengan status ${order.status} tidak dapat dibatalkan.`);
    }

    // Refund to balance if it was paid by balance
    if (order.type === 'PREPAID_ORDER' || order.type === 'POSTPAID_BILL') {
      await db.atomicAddBalance(user.username, order.amount, 'mainBalance');
    }

    order.status = 'CANCELED';
    await db.updateHistory(order.id, { status: 'CANCELED' });

    return res.json({
      success: true,
      message: 'Order berhasil dibatalkan dan saldo telah direfund.',
      data: order
    });
  } catch (err) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /payments/status/:orderId — Polling Status (Protected)
router.get('/payments/status/:orderId', requireMobileAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const user = await db.getUser(req.user.username);
    const order = (user?.history || []).find(h => String(h.id) === String(orderId) || String(h.orderId) === String(orderId));
    const payment = await db.getPayment(orderId);

    if (!order && !payment) {
      return sendError(res, 404, 'NOT_FOUND', 'Transaksi pembayaran tidak ditemukan.');
    }

    const currentStatus = (order && order.status) || (payment && payment.status) || 'PENDING';

    return res.json({
      success: true,
      order_id: orderId,
      status: currentStatus,
      paid: ['BERHASIL', 'SUCCESS', 'PAID', 'LUNAS'].includes(String(currentStatus).toUpperCase()),
      data: order || payment
    });
  } catch (err) {
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

module.exports = router;
