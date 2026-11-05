const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * FinCloud Payment Gateway Service
 * Dokumentasi resmi: https://fincloud.my.id/docs
 * Supports: QRIS Invoice (PG), Status Check, PPOB H2H Order, Webhook Verification
 * 
 * Kategori PPOB yang valid (sesuai docs):
 *   - E-Money  → brand: DANA, OVO, GOPAY
 *   - GAMES    → brand: FREE FIRE, MOBILE LEGENDS, PUBG MOBILE, dst
 *   - PULSA    → brand: TELKOMSEL, XL, INDOSAT, AXIS, TRI, SMARTFREN, BY.U
 *   - KUOTA    → brand: TELKOMSEL, XL, INDOSAT, AXIS, TRI, SMARTFREN, BY.U
 *   - TOKEN PLN → brand: PLN
 *   - SMS & TELP → brand varies
 */
class FinCloudService {
  constructor(config = {}) {
    this.baseUrl = 'https://fincloud.my.id';
    this.apiKey = config.apiKey || '';
    this.webhookSecret = config.webhookSecret || '';
    this.cacheFilePath = path.join(__dirname, 'ppob_cache.json');

    // Cache produk PPOB agar tidak flood API
    this._productCache = {};
    this._productCacheTime = {};
    this._cacheTTL = 12 * 60 * 60 * 1000; // 12 jam TTL cache normal
    this._emptyDataTTL = 30 * 60 * 1000;   // 30 menit TTL khusus untuk kategori yang datanya kosong (TOKEN PLN dll)

    // 🔒 Global API lock per-kategori — mencegah race condition antara warmup & user request
    // Key: normalizedCategory, Value: Promise yang sedang berjalan
    this._apiLocks = {};

    // Load file-based cache jika ada
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        this._productCache = parsed.cache || {};
        this._productCacheTime = parsed.timestamps || {};
        console.log('[FinCloud] Loaded file-based PPOB cache from ppob_cache.json.');
      }
    } catch (e) {
      console.error('[FinCloud] Gagal memuat file cache ppob_cache.json:', e.message);
    }

    console.log(`[FinCloud] Service initialized. API Key: ${this.apiKey.substring(0, 12)}...`);
  }

  saveCacheToFile() {
    try {
      fs.writeFileSync(this.cacheFilePath, JSON.stringify({
        cache: this._productCache,
        timestamps: this._productCacheTime
      }, null, 2), 'utf8');
      console.log('[FinCloud] PPOB cache saved to file.');
    } catch (e) {
      console.error('[FinCloud] Gagal menyimpan file cache ppob_cache.json:', e.message);
    }
  }

  /**
   * Pre-warm cache semua kategori PPOB di background saat server start.
   * FinCloud rate limit: 1 request per 2 menit (global per akun).
   * Method ini jalan di background tanpa blocking — dengan jeda 2.5 menit antar request.
   * Cache disimpan ke file sehingga tidak perlu warmup ulang selama 12 jam.
   */
  startCacheWarmup() {
    // Warmup disabled to comply with API limits
    return;
  }

  /**
   * Fetch produk dari API dengan mutex lock per-kategori.
   * Jika ada request lain yang sedang fetch kategori yang sama, tunggu hasilnya
   * daripada mengirim request duplikat yang buang rate limit.
   * Selalu menyimpan hasil ke cache (termasuk data kosong).
   * @param {string} normalizedCategory - Nama kategori resmi FinCloud
   * @returns {object} Response dari FinCloud API
   */
  _fetchWithLock(normalizedCategory) {
    // Jika sudah ada request aktif untuk kategori ini, kembalikan promise yang sama
    if (this._apiLocks[normalizedCategory]) {
      console.log(`[FinCloud] [${normalizedCategory}]: Request sedang berjalan, menunggu hasil yang sudah ada...`);
      return this._apiLocks[normalizedCategory];
    }

    // Buat promise baru dan simpan sebagai lock
    const fetchPromise = (async () => {
      try {
        const result = await this.sendRequest('/api/ppob/products', {
          apikey: this.apiKey,
          category: normalizedCategory
        });

        const key = `${normalizedCategory}_`;

        if (result && result.status === true) {
          // Simpan ke cache apapun isinya (termasuk data kosong)
          // Data kosong = kategori tidak aktif di FinCloud, bukan error
          this._productCache[key] = result;
          this._productCacheTime[key] = Date.now();
          this.saveCacheToFile();
        }
        // Rate limit atau error lain: TIDAK update cache, biarkan stale cache dipakai

        return result;
      } finally {
        // Hapus lock setelah selesai agar request berikutnya bisa fetch lagi nanti
        delete this._apiLocks[normalizedCategory];
      }
    })();

    this._apiLocks[normalizedCategory] = fetchPromise;
    return fetchPromise;
  }

  // Helper: MD5 hash untuk signature
  md5(str) {
    return crypto.createHash('md5').update(String(str)).digest('hex');
  }

  // Helper: HTTP POST dengan form-urlencoded — paksa IPv4 agar selalu cocok dengan whitelist FinCloud
  sendRequest(endpoint, params) {
    return new Promise((resolve, reject) => {
      const postData = new URLSearchParams(params).toString();
      const options = {
        hostname: 'fincloud.my.id',
        port: 443,
        path: endpoint,
        method: 'POST',
        family: 4, // ✅ PAKSA IPv4 — mencegah koneksi lewat IPv6 yang tidak terdaftar di whitelist
        timeout: 20000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Response FinCloud bukan JSON (Domain/Endpoint mengembalikan halaman Web/HTML landing page).`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout setelah 20 detik'));
      });

      req.on('error', (err) => {
        console.error(`[FinCloud] Request error [${endpoint}]:`, err.message);
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  // ==========================================
  // PAYMENT GATEWAY — QRIS DEPOSIT
  // ==========================================

  /**
   * Buat invoice QRIS baru
   * Endpoint: POST /api/create_invoice
   * Signature: MD5(apikey + nominal + reff_id)
   * @param {number} nominal - Nominal tagihan (min 1000)
   * @param {string} reffId - ID unik order dari sistem kita (max 50 char)
   * @returns {{ status, msg, data: { id_depo, reff_id, nominal_asli, nominal_total, qr_url, invoice_url } }}
   */
  async createInvoice(nominal, reffId) {
    const signature = this.md5(this.apiKey + nominal + reffId);
    const response = await this.sendRequest('/api/create_invoice', {
      apikey: this.apiKey,
      nominal: parseInt(nominal).toString(),
      reff_id: reffId,
      signature
    });
    console.log(`[FinCloud] createInvoice [${reffId}]:`, response.status, response.msg);
    return response;
  }

  /**
   * Cek status invoice QRIS berdasarkan reff_id
   * Endpoint: POST /api/cek_status
   * Signature: MD5(apikey + reff_id)
   * @param {string} reffId - ID order kita
   * @returns {{ status, msg, data: { id_depo, reff_id, nominal, status, tanggal } }}
   *   status values: 'success' | 'pending' | 'expired' | 'failed'
   */
  async checkInvoiceStatus(reffId) {
    const signature = this.md5(this.apiKey + reffId);
    const response = await this.sendRequest('/api/cek_status', {
      apikey: this.apiKey,
      reff_id: reffId,
      signature
    });
    console.log(`[FinCloud] checkInvoiceStatus [${reffId}]: status=${response?.data?.status}`);
    return response;
  }

  /**
   * Batalkan invoice QRIS (jadikan expired)
   * Endpoint: POST /api/cancel_invoice
   * Signature: MD5(apikey + reff_id)
   * @param {string} reffId
   */
  async cancelInvoice(reffId) {
    const signature = this.md5(this.apiKey + reffId);
    return this.sendRequest('/api/cancel_invoice', {
      apikey: this.apiKey,
      reff_id: reffId,
      signature
    });
  }

  /**
   * Cek saldo wallet FinCloud
   * Endpoint: POST /api/cek_saldo
   */
  async checkBalance() {
    return this.sendRequest('/api/cek_saldo', {
      apikey: this.apiKey
    });
  }

  // ==========================================
  // PPOB — PRICELIST / DAFTAR PRODUK
  // ==========================================

  /**
   * Ambil daftar produk PPOB dari FinCloud API
   * Endpoint: POST /api/ppob/products
   * Parameter: apikey, category, brand (optional)
   * 
   * Kategori valid sesuai docs FinCloud:
   *   'E-Money'   → E-Wallet (DANA, OVO, GOPAY)
   *   'GAMES'     → Game voucher (FREE FIRE, MOBILE LEGENDS, PUBG MOBILE, dll)
   *   'PULSA'     → Pulsa reguler (TELKOMSEL, XL, INDOSAT, AXIS, TRI, SMARTFREN)
   *   'KUOTA'     → Paket data internet
   *   'TOKEN PLN' → Token listrik prabayar
   *   'SMS & TELP'→ Paket SMS dan telepon
   * 
   * @param {string} category - Filter kategori produk
   * @param {string} brand - Filter brand (optional)
   * @returns {{ status: boolean, msg: string, data: Array, grouped_data: object }}
   */
  async getProducts(category = 'E-Money', brand = '') {
    // Bypassed categories (tidak didukung oleh provider FinCloud)
    if (category === 'SMS & TELP' || category === 'SMS') {
      return { status: true, msg: 'Layanan SMS & Telepon sedang tidak tersedia dari provider.', data: [] };
    }

    // Normalisasi nama kategori — pastikan selalu sesuai nama resmi FinCloud API
    const CATEGORY_ALIAS = {
      // Alias dari UI lama → nama resmi FinCloud
      'DATA': 'Data',
      'KUOTA': 'Data',
      'DIGITAL': 'Games',
      'GAMES': 'Games',
      'EMONEY': 'E-Money',
      'E-MONEY': 'E-Money',
      'PULSA': 'Pulsa',
      'TOKEN PLN': 'PLN',
      'PLN': 'PLN',
      'VOUCHER': 'Voucher',
      'Voucher': 'Voucher'
    };
    const normalizedCategory = CATEGORY_ALIAS[category] || CATEGORY_ALIAS[category.toUpperCase()] || category;
    const cacheKey = `${normalizedCategory}_`;
    const now = Date.now();

    // 1. Tentukan TTL yang berlaku — kategori data kosong pakai TTL pendek
    const cached = this._productCache[cacheKey];
    const cacheAge = now - (this._productCacheTime[cacheKey] || 0);
    const isEmptyData = cached && Array.isArray(cached.data) && cached.data.length === 0;
    const effectiveTTL = isEmptyData ? this._emptyDataTTL : this._cacheTTL;

    // 2. Kembalikan dari cache jika masih fresh
    if (cached && cached.status === true && cacheAge < effectiveTTL) {
      console.log(`[FinCloud] getProducts [${category}]: Returning from fresh cache (${Math.floor(cacheAge / 60000)}m old).`);
      return this._applyBrandFilter(cached, brand);
    }

    // 3. Cache stale/kosong — fetch dari API menggunakan lock untuk cegah race condition
    try {
      const result = await this._fetchWithLock(normalizedCategory);

      if (result && result.status === true) {
        // Cache sudah disimpan di dalam _fetchWithLock
        console.log(`[FinCloud] getProducts [${category}]: Got ${Array.isArray(result.data) ? result.data.length : 0} products from API.`);
        return this._applyBrandFilter(result, brand);
      } else {
        // API error (rate limit, dsb) — gunakan stale cache jika ada
        if (cached) {
          console.warn(`[FinCloud] getProducts [${category}]: API gagal (${result?.msg}). Pakai stale cache.`);
          return this._applyBrandFilter(cached, brand);
        }
        console.warn(`[FinCloud] getProducts [${category}]: API gagal dan tidak ada cache. Response:`, JSON.stringify(result).substring(0, 200));
        return result || { status: false, msg: 'Data produk kosong dari FinCloud.', data: [] };
      }
    } catch (err) {
      console.error(`[FinCloud] getProducts [${category}] error:`, err.message);
      // Koneksi error — fallback ke stale cache
      if (cached) {
        console.warn(`[FinCloud] getProducts [${category}]: Koneksi gagal. Pakai stale cache.`);
        return this._applyBrandFilter(cached, brand);
      }
      throw new Error(`Gagal mengambil daftar produk dari FinCloud: ${err.message}`);
    }
  }

  /**
   * Filter hasil produk berdasarkan brand (dilakukan di memori, bukan di API)
   * @private
   */
  _applyBrandFilter(categoryResult, brand) {
    if (!categoryResult || !categoryResult.status || !Array.isArray(categoryResult.data)) {
      return categoryResult;
    }
    if (!brand) return categoryResult;
    const uppercaseBrand = brand.toUpperCase();
    const filteredData = categoryResult.data.filter(p => {
      const pBrand = (p.brand || '').toUpperCase();
      return pBrand === uppercaseBrand || pBrand.includes(uppercaseBrand) || uppercaseBrand.includes(pBrand);
    });
    return { ...categoryResult, data: filteredData };
  }

  /**
   * Cari produk E-Money untuk withdraw berdasarkan nominal exact match
   * Mendukung E-Money: DANA, OVO, GOPAY, SHOPEEPAY
   * @param {number} amount - Nominal yang ingin di-withdraw
   * @param {string} method - 'DANA' | 'OVO' | 'GOPAY' | 'SHOPEEPAY'
   * @returns {{ sku, price, product_name, status } | null}
   */
  async findWithdrawSKU(amount, method = 'DANA') {
    const validBrands = {
      DANA: 'DANA',
      OVO: 'OVO',
      GOPAY: 'GO PAY',
      SHOPEEPAY: 'SHOPEE PAY'
    };
    const brand = validBrands[method.toUpperCase()];
    if (!brand) {
      throw new Error(`Metode ${method} tidak didukung. Gunakan DANA, OVO, GOPAY, atau SHOPEEPAY.`);
    }

    const result = await this.getProducts('E-Money', brand);

    if (!result || !result.status || !Array.isArray(result.data) || result.data.length === 0) {
      throw new Error(`Tidak ada produk ${brand} aktif tersedia di FinCloud saat ini.`);
    }

    const activeProducts = result.data.filter(p => (p.status || '').toLowerCase() === 'active');

    if (activeProducts.length === 0) {
      throw new Error(`Semua produk ${brand} sedang tidak aktif.`);
    }

    // Match based on nominal parsed from product_name (e.g. "DANA 10.000" -> 10000)
    const match = activeProducts.find(p => {
      const cleanName = p.product_name.replace(/[^0-9]/g, '');
      const productNominal = parseInt(cleanName, 10);
      return productNominal === parseInt(amount, 10);
    });

    if (match) return match;

    // Tidak ada match — kembalikan null
    return null;
  }

  /**
   * Buat order PPOB untuk withdraw ke e-wallet user
   * Endpoint: POST /api/ppob/order
   * Signature: MD5(apikey + reff_id)
   * 
   * @param {number} amount - Nominal withdraw (harus sesuai SKU tersedia)
   * @param {string} method - 'DANA' | 'OVO' | 'GOPAY' | 'SHOPEEPAY'
   * @param {string} targetPhone - Nomor HP tujuan (08xxxxxxxxxx)
   * @param {string} reffId - ID unik transaksi
   * @returns {{ success, status, message, data, _usedSKU, _usedPrice }}
   */
  async createWithdrawal(amount, method, targetPhone, reffId) {
    const product = await this.findWithdrawSKU(amount, method);
    if (!product) {
      // Ambil daftar denominasi tersedia untuk bantu user
      const validBrands = {
        DANA: 'DANA',
        OVO: 'OVO',
        GOPAY: 'GO PAY',
        SHOPEEPAY: 'SHOPEE PAY'
      };
      const brand = validBrands[method.toUpperCase()] || 'DANA';
      const result = await this.getProducts('E-Money', brand).catch(() => null);
      const available = result?.data
        ?.filter(p => (p.status || '').toLowerCase() === 'active')
        .map(p => {
          const cleanName = p.product_name.replace(/[^0-9]/g, '');
          return parseInt(cleanName, 10);
        })
        .filter(v => !isNaN(v)) || [];
      const hint = available.length > 0
        ? `Denominasi tersedia: Rp ${[...new Set(available)].sort((a, b) => a - b).map(v => parseInt(v).toLocaleString('id-ID')).join(', Rp ')}`
        : 'Silakan periksa ketersediaan produk di FinCloud.';
      throw new Error(`Nominal Rp ${amount.toLocaleString('id-ID')} tidak tersedia untuk ${method}. ${hint}`);
    }

    const signature = this.md5(this.apiKey + reffId);
    const response = await this.sendRequest('/api/ppob/order', {
      apikey: this.apiKey,
      sku: product.sku,
      target: targetPhone,
      reff_id: reffId,
      signature
    });

    console.log(`[FinCloud] createWithdrawal [${reffId}] SKU=${product.sku} Target=${targetPhone}:`, response.status, response.msg);

    // Sesuai docs: status true = pending/success, false = gagal (sudah di-refund oleh FinCloud)
    return {
      success: !!response.status,
      message: response.msg || '',
      status: response.data?.status || (response.status ? 'pending' : 'failed'),
      data: response.data || {},
      _usedSKU: product.sku,
      _usedPrice: product.price
    };
  }

  /**
   * Kirim order PPOB H2H (Pulsa, Kuota, Token PLN, Game, dll)
   * Endpoint: POST /api/ppob/order
   * Signature: MD5(apikey + reff_id)
   * 
   * @param {string} sku - SKU produk (dari getProducts)
   * @param {string} target - Nomor tujuan / ID pelanggan
   * @param {string} reffId - ID referensi unik
   * @returns {{ status: boolean, msg: string, data: object }}
   */
  async createPPOBOrder(sku, target, reffId) {
    const signature = this.md5(this.apiKey + reffId);
    const response = await this.sendRequest('/api/ppob/order', {
      apikey: this.apiKey,
      sku,
      target,
      reff_id: reffId,
      signature
    });

    console.log(`[FinCloud PPOB Order] [${reffId}] SKU=${sku} Target=${target}:`, response.status, response.msg);
    return response;
  }

  /**
   * Cek status transaksi PPOB (withdraw/order)
   * Endpoint: POST /api/ppob/status
   * Signature: MD5(apikey + reff_id)
   * @param {string} reffId
   * @returns {{ status, msg, data: { status: 'success'|'pending'|'failed', sn, ... } }}
   */
  async checkWithdrawalStatus(reffId) {
    const signature = this.md5(this.apiKey + reffId);
    return this.sendRequest('/api/ppob/status', {
      apikey: this.apiKey,
      reff_id: reffId,
      signature
    });
  }

  // ==========================================
  // WEBHOOK VERIFICATION
  // ==========================================

  /**
   * Verifikasi signature webhook Payment Gateway (deposit QRIS)
   * Formula: MD5(apikey + reff_id + status)
   * @param {string} reffId
   * @param {string} status - 'success' | 'failed'
   * @param {string} signature - signature dari payload webhook
   */
  verifyWebhookPG(reffId, status, signature) {
    if (!signature) return false;
    const expected = this.md5(this.apiKey + reffId + status);
    return signature === expected;
  }

  /**
   * Verifikasi signature webhook PPOB (withdraw/order H2H)
   * Formula HMAC-SHA256: hash_hmac('sha256', reff_id + '.' + nominal + '.' + status + '.' + rrn, webhook_secret)
   * Dikirim di header: X-Webhook-Signature
   * @param {string} reffId
   * @param {string|number} nominal
   * @param {string} status - 'success' | 'failed'
   * @param {string} rrn - Serial Number (SN) atau pesan error jika gagal
   * @param {string} signatureHmac - dari header X-Webhook-Signature atau body signature_hmac
   */
  verifyWebhookPPOB(reffId, nominal, status, rrn, signatureHmac) {
    if (!this.webhookSecret || !signatureHmac) {
      console.warn('[FinCloud] PPOB webhook secret tidak diset — verifikasi dilewati.');
      return true; // bypass jika belum diset
    }
    try {
      const stringToSign = `${reffId}.${nominal}.${status}.${rrn}`;
      const expected = crypto.createHmac('sha256', this.webhookSecret)
        .update(stringToSign)
        .digest('hex');
      return crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(signatureHmac, 'hex')
      );
    } catch (err) {
      console.error('[FinCloud] PPOB webhook verification error:', err.message);
      return false;
    }
  }

  // ==========================================
  // STATUS MAPPERS
  // ==========================================

  /**
   * Map status FinCloud deposit ke status internal
   * API values: 'success' | 'pending' | 'expired' | 'cancelled' | 'failed'
   */
  mapDepositStatus(apiStatus) {
    const s = String(apiStatus || '').toLowerCase();
    if (s === 'success') return 'PAID';
    if (s === 'expired' || s === 'cancelled') return 'EXPIRED';
    if (s === 'failed') return 'FAILED';
    return 'PENDING';
  }

  /**
   * Map status FinCloud PPOB ke label history transaksi
   * API values: 'success' | 'pending' | 'failed'
   */
  mapWithdrawStatus(apiStatus) {
    const s = String(apiStatus || '').toLowerCase();
    if (s === 'success') return 'BERHASIL';
    if (s === 'failed') return 'GAGAL';
    return 'DIPROSES'; // pending / process
  }
}

module.exports = FinCloudService;
