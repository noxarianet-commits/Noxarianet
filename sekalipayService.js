const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

/**
 * SekaliPay Reseller API Service v1.0
 * Dokumentasi API: SekaliPay Reseller API
 * Base URL: https://sekalipay.com/api
 */
class SekaliPayService {
  constructor(config = {}) {
    this.baseUrl = (config.baseUrl || 'https://sekalipay.com/api').replace(/\/+$/, '');
    this.apiKey = config.apiKey || process.env.SEKALIPAY_API_KEY || '';
    this.webhookSecret = config.webhookSecret || process.env.SEKALIPAY_WEBHOOK_SECRET || '';
    this.cacheFilePath = path.join(__dirname, 'sekalipay_cache.json');

    this._itemCache = null;
    this._itemCacheTime = 0;
    this._cacheTTL = 1 * 60 * 60 * 1000; // 1 jam TTL

    this.loadCache();
    console.log(`[SekaliPay] Service initialized. API Key: ${this.apiKey ? (this.apiKey.substring(0, 10) + '...') : 'NOT SET'}`);
  }

  loadCache() {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        this._itemCache = parsed.data || null;
        this._itemCacheTime = parsed.timestamp || 0;
        console.log('[SekaliPay] Loaded file-based items cache from sekalipay_cache.json.');
      }
    } catch (e) {
      console.error('[SekaliPay] Error loading cache:', e.message);
    }
  }

  saveCache() {
    try {
      fs.writeFileSync(this.cacheFilePath, JSON.stringify({
        data: this._itemCache,
        timestamp: this._itemCacheTime
      }, null, 2), 'utf8');
      console.log('[SekaliPay] Items cache saved to sekalipay_cache.json.');
    } catch (e) {
      console.error('[SekaliPay] Error saving cache:', e.message);
    }
  }

  /**
   * Helper HTTP Request ke SekaliPay API
   */
  async sendRequest(endpoint, method = 'GET', data = null) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const urlStr = this.baseUrl + cleanEndpoint;
    const urlObj = new URL(urlStr);

    const headers = {
      'X-APIKEY': this.apiKey,
      'Accept': 'application/json'
    };

    let postData = null;
    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      postData = typeof data === 'string' ? data : JSON.stringify(data);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method.toUpperCase(),
      headers: headers,
      timeout: 30000
    };

    const lib = urlObj.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = lib.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve({
              httpCode: res.statusCode,
              ...parsed
            });
          } catch (e) {
            resolve({
              httpCode: res.statusCode,
              success: false,
              message: 'INVALID_JSON_RESPONSE',
              raw: body
            });
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`[SekaliPay API Error] ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('[SekaliPay API Error] Connection Timeout (30s)'));
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  /**
   * Cek Saldo SekaliPay Reseller
   * GET /v1/balance
   */
  async getBalance() {
    return await this.sendRequest('/v1/balance', 'GET');
  }

  /**
   * Helper untuk meratakan (flatten) data dari SekaliPay
   * yang berbentuk Kategori -> Produk -> Variants
   */
  flattenItems(rawData) {
    if (!Array.isArray(rawData)) return [];
    const flattened = [];

    rawData.forEach(cat => {
      // Jika struktur langsung variant item
      if (cat.id && cat.price !== undefined) {
        flattened.push({
          id: cat.id,
          name: cat.name || 'Item SekaliPay',
          category: cat.category || 'PPOB',
          brand: cat.product_name || cat.brand || 'SEKALIPAY',
          price: cat.price || 0,
          stock: cat.stock !== undefined ? cat.stock : 99,
          sku: cat.sku || `SKL-${cat.id}`,
          order_process: cat.order_process || 'h2h'
        });
        return;
      }

      // Jika struktur bertingkat Kategori -> Products -> Variants
      const products = cat.products || (cat.variants ? [cat] : []);
      const categoryName = cat.name || 'PPOB';

      products.forEach(prod => {
        const productName = prod.name || categoryName;
        const subCategoryName = prod.sub_category?.name || categoryName;
        const variants = prod.variants || [];

        variants.forEach(variant => {
          flattened.push({
            id: variant.id,
            name: `${productName} ${variant.name || ''}`.trim(),
            category: subCategoryName,
            brand: productName,
            price: variant.price || 0,
            stock: variant.stock !== undefined ? variant.stock : 99,
            sku: variant.sku || `SKL-${variant.id}`,
            order_process: variant.order_process || 'h2h',
            raw: variant
          });
        });
      });
    });

    return flattened;
  }

  /**
   * Get List Items / Products
   * GET /v1/item?per_page=all
   */
  async getItems(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this._itemCache && (now - this._itemCacheTime < this._cacheTTL)) {
      return { success: true, cached: true, data: this._itemCache };
    }

    try {
      const res = await this.sendRequest('/v1/item?per_page=all', 'GET');
      if (res && (res.data || Array.isArray(res))) {
        const rawData = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);
        const items = this.flattenItems(rawData);
        this._itemCache = items;
        this._itemCacheTime = now;
        this.saveCache();
        return { success: true, cached: false, data: items };
      }
      if (this._itemCache) {
        return { success: true, cached: true, fallback: true, data: this._itemCache };
      }
      return res;
    } catch (err) {
      if (this._itemCache) {
        console.warn('[SekaliPay] Fetch failed, falling back to cache:', err.message);
        return { success: true, cached: true, fallback: true, data: this._itemCache };
      }
      throw err;
    }
  }

  /**
   * Cek Detail 1 Item
   * GET /v1/item/{id}
   */
  async getItemDetail(itemId) {
    return await this.sendRequest(`/v1/item/${itemId}`, 'GET');
  }

  /**
   * Validasi Akun / Nickname Lookup
   * POST /v1/item/validate
   */
  async validateAccount(itemId, customerId, zoneId = null) {
    const payload = {
      item_id: parseInt(itemId, 10),
      customer_id: String(customerId)
    };
    if (zoneId) {
      payload.zone_id = String(zoneId);
    }
    return await this.sendRequest('/v1/item/validate', 'POST', payload);
  }

  /**
   * Stock Lock
   * POST /v1/item/lock
   */
  async lockStock(itemId, quantity = 1, lockDuration = 600) {
    const payload = {
      item_id: parseInt(itemId, 10),
      quantity: parseInt(quantity, 10),
      lock_duration: parseInt(lockDuration, 10)
    };
    return await this.sendRequest('/v1/item/lock', 'POST', payload);
  }

  /**
   * Release Stock Lock
   * DELETE /v1/item/lock/{lockToken}
   */
  async releaseStockLock(lockToken) {
    return await this.sendRequest(`/v1/item/lock/${lockToken}`, 'DELETE');
  }

  /**
   * Create Transaction
   * POST /v1/trx
   * Supports both (refId, carts, lockToken) and ({ sku/item_id, target/note, ref_id, quantity })
   */
  async createTransaction(arg1, arg2 = null, lockToken = null) {
    let refId, carts;
    if (typeof arg1 === 'object' && arg1 !== null && !Array.isArray(arg1)) {
      refId = arg1.ref_id || arg1.refId || `TRX_${Date.now()}`;
      const itemId = arg1.item_id || arg1.itemId || String(arg1.sku || '').replace(/^SKL-/, '') || arg1.sku;
      const noteVal = arg1.target || arg1.note || '';
      carts = [{ item_id: parseInt(itemId, 10), quantity: parseInt(arg1.quantity || 1, 10), note: noteVal }];
      lockToken = arg1.lock_token || arg1.lockToken || lockToken;
    } else {
      refId = arg1;
      carts = Array.isArray(arg2) ? arg2 : [];
    }

    const formattedCarts = carts.map(c => {
      let noteVal = c.note;
      if (typeof noteVal === 'object' && noteVal !== null) {
        noteVal = JSON.stringify(noteVal);
      }
      return {
        item_id: parseInt(c.item_id || String(c.sku || '').replace(/^SKL-/, ''), 10),
        quantity: parseInt(c.quantity || 1, 10),
        note: noteVal || ''
      };
    });

    const payload = {
      ref_id: String(refId),
      carts: formattedCarts
    };

    if (lockToken) {
      payload.lock_token = String(lockToken);
    }

    return await this.sendRequest('/v1/trx', 'POST', payload);
  }

  /**
   * Get Transaction Detail
   * GET /v1/trx/{ref_id}
   */
  async getTransactionDetail(refId) {
    return await this.sendRequest(`/v1/trx/${refId}`, 'GET');
  }

  /**
   * Verify Webhook Signature HMAC SHA256
   * signature = SHA256(ref_id + ":" + invoice + ":" + status + ":" + webhook_secret)
   */
  verifyWebhookSignature(payload, receivedSignature) {
    if (!receivedSignature || !payload || !payload.data) return false;
    const secret = this.webhookSecret;
    if (!secret) {
      console.warn('[SekaliPay Webhook] Warning: WEBHOOK_SECRET is empty. Skipping signature verification.');
      return true;
    }

    const event = payload.event || '';
    const statusForSignature = event === 'order.item.sent'
      ? 'item.sent'
      : (event === 'webhook.test' ? 'test' : (payload.data.status || ''));

    const refId = payload.data.ref_id || '';
    const invoice = payload.data.invoice || '';

    const sigString = `${refId}:${invoice}:${statusForSignature}:${secret}`;
    const expectedSig = crypto.createHash('sha256').update(sigString).digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSig.toLowerCase()),
      Buffer.from(String(receivedSignature).toLowerCase())
    );
  }
}

module.exports = SekaliPayService;
