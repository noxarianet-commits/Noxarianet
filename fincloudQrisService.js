const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

/**
 * Konfigurasi Resmi Rate Limit FinCloud Platform (Jendela Waktu Bergerak 1 Menit)
 * Berdasarkan Dokumentasi Resmi FinCloud 2026:
 * - Default / Create: 60 req / menit (/create_invoice, dll)
 * - Cek Status: 30 req / menit (/cek_status, dll)
 * - Batal Transaksi: 20 req / menit (/cancel_invoice, dll)
 * - Cek Profil: 2 req / menit (/profile)
 * - Withdraw Saldo: 1 req / 1 jam (/withdraw)
 */
const FINCLOUD_RATE_LIMITS = {
  create: { limit: 60, safeLimit: 55, windowMs: 60 * 1000, name: 'Default / Create (/create_invoice)' },
  check: { limit: 30, safeLimit: 25, windowMs: 60 * 1000, name: 'Cek Status (/cek_status)' },
  cancel: { limit: 20, safeLimit: 18, windowMs: 60 * 1000, name: 'Batal Transaksi (/cancel_invoice)' },
  profile: { limit: 2, safeLimit: 2, windowMs: 60 * 1000, name: 'Cek Profil (/profile)' },
  withdraw: { limit: 1, safeLimit: 1, windowMs: 3600 * 1000, name: 'Withdraw Saldo (/withdraw)' }
};

/**
 * FinCloud Dynamic QRIS Service
 * Dokumentasi Resmi: https://fincloud.my.id/docs
 * 
 * Standar Komunikasi:
 * - Host: fincloud.my.id (Port 443)
 * - Jaringan: Wajib IPv4 (family: 4) agar terverifikasi oleh IP Whitelist FinCloud
 * - Content-Type: application/x-www-form-urlencoded
 * - Signature create_invoice: MD5(apikey + nominal + reff_id)
 * - Signature cek_status: MD5(apikey + reff_id)
 * - Signature cancel_invoice: MD5(apikey + reff_id)
 */
class FinCloudQrisService {
  constructor(config = {}) {
    let rawBaseUrl = (config.baseUrl || process.env.FINCLOUD_BASE_URL || 'https://fincloud.my.id').trim();
    
    // Normalisasi: jika base URL mengandung api.fincloud.my.id, ganti ke fincloud.my.id
    if (rawBaseUrl.includes('api.fincloud.my.id')) {
      rawBaseUrl = 'https://fincloud.my.id';
    }
    this.baseUrl = rawBaseUrl.replace(/\/+$/, '');
    this.apiKey = (config.apiKey || process.env.FINCLOUD_API_KEY || 'fc_live_038b7a0ff8fcb9362adfd931abe2dc94').trim();

    // Sliding window tracker per kategori untuk FinCloud Rate Limiting
    this.rateLimitWindows = {
      create: [],
      check: [],
      cancel: [],
      profile: [],
      withdraw: []
    };

    // Cooldown penalti jika FinCloud mengembalikan HTTP 429 atau Retry-After
    this.blockedUntil = {
      create: 0,
      check: 0,
      cancel: 0,
      profile: 0,
      withdraw: 0
    };

    // Cache in-memory untuk status cek invoice agar polling client tidak membebani kuota FinCloud
    this.statusCheckCache = new Map();

    // Daftar kandidat path untuk endpoint invoice
    this.invoiceEndpoints = [
      '/api/create_invoice',
      '/create_invoice'
    ];

    // Daftar kandidat path untuk cek status
    this.statusEndpoints = [
      '/api/cek_status',
      '/cek_status'
    ];

    // Daftar kandidat path untuk cancel invoice
    this.cancelEndpoints = [
      '/api/cancel_invoice',
      '/cancel_invoice'
    ];

    const initialKey = this.getApiKey();
    console.log(`[FinCloud QRIS] Service diinisialisasi. Base URL: ${this.baseUrl}, API Key Aktif: ${initialKey.substring(0, 14)}...`);
  }

  /**
   * Mengambil API Key FinCloud secara dinamis:
   * 1. Selalu memindai langsung file .env di disk agar perubahan key langsung aktif secara instan tanpa restart Node.js
   * 2. Fallback ke process.env atau constructor
   * @returns {string} Active API Key
   */
  getApiKey() {
    try {
      const envPath = path.resolve(__dirname, '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/FINCLOUD_API_KEY\s*=\s*([^\r\n#]+)/);
        if (match && match[1]) {
          const fileKey = match[1].trim();
          if (fileKey) {
            process.env.FINCLOUD_API_KEY = fileKey;
            this.apiKey = fileKey;
            return fileKey;
          }
        }
      }
    } catch (e) {
      // Abaikan error baca disk
    }

    const key = (process.env.FINCLOUD_API_KEY || this.apiKey || 'fc_live_038b7a0ff8fcb9362adfd931abe2dc94').trim();
    this.apiKey = key;
    return key;
  }

  /**
   * Memeriksa dan menegakkan kuota Rate Limit FinCloud di sisi klien sebelum request dikirim
   * Sesuai kuota resmi:
   * - create: 60 req/menit
   * - check: 30 req/menit
   * - cancel: 20 req/menit
   * @param {'create'|'check'|'cancel'|'profile'|'withdraw'} category
   */
  checkAndEnforceRateLimit(category = 'create') {
    const config = FINCLOUD_RATE_LIMITS[category] || FINCLOUD_RATE_LIMITS.create;
    const now = Date.now();

    // 1. Cek apakah FinCloud pernah mengirim penalti 429 Retry-After sebelumnya
    if (this.blockedUntil[category] && now < this.blockedUntil[category]) {
      const waitSeconds = Math.max(1, Math.ceil((this.blockedUntil[category] - now) / 1000));
      const msg = `Batas kuota API FinCloud tercapai untuk ${config.name}. Coba lagi dalam ${waitSeconds} detik (FinCloud Retry-After).`;
      console.warn(`⚠️ [FinCloud RateLimit Cooldown]: ${msg}`);
      const err = new Error(msg);
      err.statusCode = 429;
      err.retryAfter = waitSeconds;
      throw err;
    }

    // 2. Bersihkan timestamp di luar jendela sliding (60 detik)
    if (!this.rateLimitWindows[category]) {
      this.rateLimitWindows[category] = [];
    }
    const windowStart = now - config.windowMs;
    this.rateLimitWindows[category] = this.rateLimitWindows[category].filter(t => t > windowStart);

    const currentCount = this.rateLimitWindows[category].length;
    const limit = config.safeLimit || config.limit;

    if (currentCount >= limit) {
      const oldest = this.rateLimitWindows[category][0] || now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000));
      const msg = `Batas kuota API FinCloud tercapai untuk ${config.name} (${currentCount}/${config.limit} req/menit). Coba lagi dalam ${retryAfterSeconds} detik.`;
      console.warn(`⚠️ [FinCloud Rate Limit Guard]: ${msg}`);
      const err = new Error(msg);
      err.statusCode = 429;
      err.retryAfter = retryAfterSeconds;
      throw err;
    }

    // Catat request baru
    this.rateLimitWindows[category].push(now);
    const remaining = config.limit - this.rateLimitWindows[category].length;
    console.log(`[FinCloud RateLimit] [${category}] ${this.rateLimitWindows[category].length}/${config.limit} req (Sisa kuota aman: ${remaining} req/menit)`);
    return { success: true, remaining, limit: config.limit };
  }

  /**
   * Catat penalti HTTP 429 yang dikembalikan langsung oleh server FinCloud
   * @param {string} category
   * @param {number} retryAfterSeconds
   */
  recordRateLimitPenalty(category = 'create', retryAfterSeconds = 48) {
    const penaltyMs = Math.max(5, parseInt(retryAfterSeconds, 10) || 48) * 1000;
    this.blockedUntil[category] = Date.now() + penaltyMs;
    console.warn(`🛑 [FinCloud 429 Too Many Requests] Kategori '${category}' terkena cooldown FinCloud selama ${penaltyMs / 1000} detik.`);
  }

  /**
   * Helper kalkulasi hash MD5 sesuai spesifikasi FinCloud
   * @param {string} str
   * @returns {string} Hexadecimal lowercase
   */
  md5(str) {
    return crypto.createHash('md5').update(String(str)).digest('hex');
  }

  /**
   * Helper backward compatibility: Signature HMAC jika sewaktu-waktu dibutuhkan
   * @param {string} reffId
   * @param {number|string} nominal
   * @returns {string} Hexadecimal signature
   */
  generateSignature(reffId, nominal) {
    const activeKey = this.getApiKey();
    return this.md5(`${activeKey}${nominal}${reffId}`);
  }

  /**
   * Helper request HTTP POST dengan form-urlencoded dan IPv4 forcing
   * @param {string} endpointPath - path misal '/api/create_invoice'
   * @param {object} params - parameter key-value
   * @param {number} timeoutMs - batas waktu request dalam ms
   * @returns {Promise<{statusCode: number, data: object, raw: string}>}
   */
  sendFormRequest(endpointPath, params, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const fullUrl = `${this.baseUrl}${endpointPath.startsWith('/') ? endpointPath : '/' + endpointPath}`;
      const urlObj = new URL(fullUrl);
      const postData = new URLSearchParams(params).toString();
      const isHttps = urlObj.protocol === 'https:';
      const transport = isHttps ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        family: 4, // Wajib IPv4 agar sesuai dengan Whitelist FinCloud
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NoxaWallet/1.0'
        }
      };

      const req = transport.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseBody);
            // Deteksi respon 429 atau pesan batas kuota dari server FinCloud
            if (res.statusCode === 429 || (parsed && parsed.status === false && (parsed.retry_after_seconds || (parsed.msg && parsed.msg.includes('Batas kuota'))))) {
              const retryAfter = parsed.retry_after_seconds || parseInt(res.headers['retry-after'], 10) || 48;
              this.recordRateLimitPenalty(parsed.category || 'create', retryAfter);
            }
            resolve({ statusCode: res.statusCode, data: parsed, raw: responseBody, headers: res.headers });
          } catch (jsonErr) {
            resolve({ statusCode: res.statusCode, error: 'NON_JSON', raw: responseBody, headers: res.headers });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout menghubungi FinCloud (${fullUrl}) setelah ${timeoutMs / 1000} detik`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Mengunduh gambar QR dari URL FinCloud dan mengonversi menjadi data:image/png;base64,...
   * Menghindari masalah CORS canvas saat user menekan 'Unduh QRIS' di frontend.
   * @param {string} imageUrl
   * @returns {Promise<string|null>} Base64 data URL
   */
  async fetchImageAsBase64(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
      return null;
    }

    return new Promise((resolve) => {
      try {
        const urlObj = new URL(imageUrl);
        const isHttps = urlObj.protocol === 'https:';
        const transport = isHttps ? https : http;

        const req = transport.get(imageUrl, { family: 4, timeout: 8000 }, (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return resolve(null);
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const contentType = res.headers['content-type'] || 'image/png';
            resolve(`data:${contentType};base64,${buffer.toString('base64')}`);
          });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => {
          req.destroy();
          resolve(null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * 1. Buat Tagihan Dynamic QRIS FinCloud
   * Endpoint: POST /api/create_invoice
   * Payload: apikey, nominal, reff_id, signature (MD5)
   * Dilindungi Kuota Rate Limit: 60 req / menit
   * 
   * @param {number|string} nominal - Nominal deposit (minimal 1000)
   * @param {string} reffId - ID referensi unik internal
   * @returns {Promise<object>} Detail tagihan invoice QRIS
   */
  async createInvoice(nominal, reffId) {
    const numNominal = Math.ceil(parseInt(nominal, 10));
    if (isNaN(numNominal) || numNominal < 1000) {
      throw new Error('Nominal tagihan top up minimal Rp 1.000.');
    }

    // 1. Validasi & catat Rate Limit kategori 'create' (60 req / menit)
    this.checkAndEnforceRateLimit('create');

    const cleanReffId = String(reffId || `TOPUP_${Date.now()}`).trim();
    // 2. Ambil live API Key aktif langsung dari disk/.env
    const activeKey = this.getApiKey();

    // 3. Signature resmi FinCloud: MD5(apikey + nominal + reff_id)
    const signature = this.md5(`${activeKey}${numNominal}${cleanReffId}`);

    console.log(`[FinCloud QRIS] Membuat invoice: reff_id=${cleanReffId}, nominal=Rp ${numNominal.toLocaleString('id-ID')}`);
    console.log(`[FinCloud QRIS] Menggunakan API Key: ${activeKey.substring(0, 14)}... (Total: ${activeKey.length} karakter)`);
    console.log(`[FinCloud QRIS] Signature MD5: ${signature}`);

    const payload = {
      apikey: activeKey,
      nominal: String(numNominal),
      reff_id: cleanReffId,
      signature: signature
    };

    let lastError = null;
    let apiResult = null;

    // Coba endpoint resmi terlebih dahulu (/api/create_invoice lalu /create_invoice)
    for (const endpoint of this.invoiceEndpoints) {
      try {
        console.log(`[FinCloud QRIS] Mencoba endpoint: ${this.baseUrl}${endpoint}`);
        const result = await this.sendFormRequest(endpoint, payload, 20000);

        if (result.data) {
          apiResult = result.data;
          console.log(`[FinCloud QRIS] Respon dari ${endpoint}:`, JSON.stringify(apiResult));
          break;
        } else if (result.statusCode === 404) {
          console.warn(`[FinCloud QRIS] Endpoint ${endpoint} mengembalikan 404, mencoba endpoint alternatif...`);
          continue;
        } else if (result.raw) {
          console.warn(`[FinCloud QRIS] Respon non-JSON dari ${endpoint}:`, result.raw.substring(0, 120));
        }
      } catch (err) {
        lastError = err;
        console.error(`[FinCloud QRIS] Gagal pada ${endpoint}:`, err.message);
      }
    }

    if (!apiResult) {
      throw lastError || new Error('Gagal menghubungi server FinCloud QRIS (tidak ada respon valid).');
    }

    // Periksa status respon FinCloud
    const isSuccess = apiResult.status === true || apiResult.success === true || apiResult.status === 'success';
    if (!isSuccess) {
      const errorMsg = apiResult.msg || apiResult.message || apiResult.error || 'Ditolak oleh FinCloud';
      console.error(`❌ [FinCloud QRIS Ditolak]: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Ekstraksi data invoice FinCloud
    const resData = (apiResult.data && typeof apiResult.data === 'object') ? apiResult.data : apiResult;

    const totalAmount = Math.ceil(
      Number(resData.nominal_total || resData.total_bayar || resData.total_amount || resData.amount || numNominal)
    );
    const uniqueCode = totalAmount > numNominal ? (totalAmount - numNominal) : (resData.kode_unik || 0);

    const rawQrString = String(resData.qr_string || resData.qris_string || resData.payload || resData.qr_content || '').trim();
    let qrUrl = String(resData.qr_url || resData.qr_image || resData.invoice_url || '').trim();
    let qrBase64 = String(resData.qr_base64 || '').trim();

    // 1. Jika string QRIS (EMVCo payload) dikembalikan, generate Base64 langsung
    if (rawQrString) {
      try {
        qrBase64 = await QRCode.toDataURL(rawQrString, {
          errorCorrectionLevel: 'M',
          margin: 2,
          scale: 8,
          color: { dark: '#000000', light: '#ffffff' }
        });
      } catch (qrErr) {
        console.warn('[FinCloud QRIS] Gagal generate Base64 dari qr_string:', qrErr.message);
      }
    }

    // 2. Jika qr_url berupa link gambar online dan qr_base64 belum ada, unduh server-side via IPv4
    if (!qrBase64 && qrUrl && qrUrl.startsWith('http')) {
      try {
        const fetchedBase64 = await this.fetchImageAsBase64(qrUrl);
        if (fetchedBase64) {
          qrBase64 = fetchedBase64;
          console.log('[FinCloud QRIS] Berhasil mengunduh gambar QR ke Base64 (CORS-safe).');
        }
      } catch (fetchErr) {
        console.warn('[FinCloud QRIS] Gagal mengunduh gambar QR ke Base64, menggunakan direct URL:', fetchErr.message);
      }
    }

    // Pastikan salah satu format gambar tersedia
    const finalQrImage = qrBase64 || qrUrl;
    if (!finalQrImage && !rawQrString) {
      throw new Error(`FinCloud tidak mengembalikan data QRIS yang valid: ${JSON.stringify(apiResult)}`);
    }

    return {
      success: true,
      status: 'PENDING',
      message: apiResult.msg || apiResult.message || 'Invoice FinCloud Dynamic QRIS berhasil dibuat',
      reff_id: cleanReffId,
      invoice: resData.id_depo || resData.invoice_id || resData.invoice || cleanReffId,
      nominal_awal: numNominal,
      kode_unik: uniqueCode,
      total_amount: totalAmount,
      amount: totalAmount,
      qr_string: rawQrString,
      qr_url: qrUrl || finalQrImage,
      qr_base64: finalQrImage,
      payment_link: resData.invoice_url || qrUrl || '',
      expired_at: resData.expired_at || resData.kadaluarsa || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      raw: apiResult
    };
  }

  /**
   * 2. Pengecekan Status Pembayaran Tagihan QRIS Real-Time
   * Endpoint: POST /api/cek_status
   * Payload: apikey, reff_id, signature (MD5)
   * Dilindungi Kuota Rate Limit: 30 req / menit & Cache 8 Detik
   * 
   * @param {string} reffId - ID referensi order kita
   * @returns {Promise<{success: boolean, status: string, rawStatus: string, reff_id: string, amount: number, data: object, raw: object}>}
   */
  async checkInvoiceStatus(reffId) {
    const cleanReffId = String(reffId || '').trim();
    if (!cleanReffId) {
      throw new Error('reff_id wajib diisi untuk cek status.');
    }

    // Cek in-memory cache: jika status baru dicek dalam 8 detik terakhir, kembalikan hasil cache
    const cached = this.statusCheckCache.get(cleanReffId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    // Terapkan Rate Limit FinCloud resmi (30 req / menit)
    this.checkAndEnforceRateLimit('check');

    const activeKey = this.getApiKey();
    // Signature cek_status FinCloud: MD5(apikey + reff_id)
    const signature = this.md5(`${activeKey}${cleanReffId}`);

    const payload = {
      apikey: activeKey,
      reff_id: cleanReffId,
      signature: signature
    };

    let apiResult = null;
    let lastError = null;

    for (const endpoint of this.statusEndpoints) {
      try {
        const result = await this.sendFormRequest(endpoint, payload, 15000);
        if (result.data) {
          apiResult = result.data;
          break;
        } else if (result.statusCode === 404) {
          continue;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!apiResult) {
      throw lastError || new Error('Gagal mengecek status ke FinCloud.');
    }

    const resData = (apiResult.data && typeof apiResult.data === 'object') ? apiResult.data : apiResult;
    const rawStatus = String(resData.status || apiResult.status_transaksi || apiResult.status || '').toLowerCase();

    let normalizedStatus = 'PENDING';
    if (['success', 'paid', 'berhasil', 'lunas', 'completed'].includes(rawStatus)) {
      normalizedStatus = 'PAID';
    } else if (['expired', 'kadaluarsa', 'batal', 'cancelled', 'canceled'].includes(rawStatus)) {
      normalizedStatus = 'EXPIRED';
    } else if (['failed', 'gagal'].includes(rawStatus)) {
      normalizedStatus = 'FAILED';
    }

    const resultObj = {
      success: true,
      status: normalizedStatus,
      rawStatus: rawStatus,
      reff_id: cleanReffId,
      amount: Number(resData.nominal_total || resData.total_bayar || resData.nominal || resData.amount || 0),
      data: resData,
      raw: apiResult
    };

    // Simpan ke cache selama 8 detik agar query beruntun dari polling frontend aman dari limit
    this.statusCheckCache.set(cleanReffId, {
      data: resultObj,
      expiresAt: Date.now() + 8000
    });

    return resultObj;
  }

  /**
   * 3. Batalkan Tagihan QRIS
   * Endpoint: POST /api/cancel_invoice
   * Dilindungi Kuota Rate Limit: 20 req / menit
   * @param {string} reffId
   */
  async cancelInvoice(reffId) {
    const cleanReffId = String(reffId || '').trim();
    if (!cleanReffId) {
      throw new Error('reff_id wajib diisi untuk cancel invoice.');
    }

    // Terapkan Rate Limit FinCloud resmi (20 req / menit)
    this.checkAndEnforceRateLimit('cancel');

    const activeKey = this.getApiKey();
    const signature = this.md5(`${activeKey}${cleanReffId}`);
    const payload = {
      apikey: activeKey,
      reff_id: cleanReffId,
      signature: signature
    };

    for (const endpoint of this.cancelEndpoints) {
      try {
        const result = await this.sendFormRequest(endpoint, payload, 15000);
        if (result.data) {
          return result.data;
        }
      } catch (err) {
        // Continue to fallback
      }
    }

    return { status: false, msg: 'Endpoint cancel_invoice tidak merespon' };
  }

  /**
   * 4. Cek Saldo FinCloud
   * Endpoint: POST /api/cek_saldo
   */
  async checkBalance() {
    try {
      this.checkAndEnforceRateLimit('check');
      const activeKey = this.getApiKey();
      const result = await this.sendFormRequest('/api/cek_saldo', {
        apikey: activeKey
      }, 15000);
      return result.data || result;
    } catch (err) {
      return { status: false, msg: err.message };
    }
  }
}

module.exports = FinCloudQrisService;
