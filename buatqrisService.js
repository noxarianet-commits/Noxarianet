const crypto = require('crypto');

/**
 * Service to handle integration with BuatQRIS.site payment gateway.
 * Supports cookie challenge bypass, dynamic QRIS generation, status polling, and withdrawal requests.
 */
class BuatQRISService {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || 'https://app.buatqris.site/api.php';
    this.apiKey = config.apiKey || '';
    this.accountId = config.accountId || '';
    this.signingSecret = config.signingSecret || '';
    this.sandboxMode = config.sandboxMode !== undefined ? config.sandboxMode : false;
    this.cookieHeader = '';
    
    console.log(`[BuatQRIS Service] Initialized. URL: ${this.apiUrl}, Sandbox Mode: ${this.sandboxMode}`);
  }

  /**
   * Helper method to execute requests to BuatQRIS API.
   * Handles resolving the slowAES cookie challenge automatically.
   * @param {object} payload - Key-value payload for request
   * @returns {Promise<any>}
   */
  async sendRequest(payload) {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    
    // Add credentials
    payload.account_id = this.accountId;
    payload.secret_token = this.apiKey;

    // Attach __test cookie if already solved
    if (this.cookieHeader) {
      headers['Cookie'] = this.cookieHeader;
    }

    try {
      let res = await fetch(this.apiUrl + (this.cookieHeader ? '?i=1' : ''), {
        method: 'POST',
        headers: headers,
        body: new URLSearchParams(payload)
      });

      let text = await res.text();

      // Check if server is throwing the slowAES cookie challenge
      if (text.includes('slowAES.decrypt') && text.includes('toNumbers')) {
        console.log('[BuatQRIS Service] Cookie challenge detected. Solving...');
        
        // Parse keys from challenge HTML
        const aMatch = text.match(/toNumbers\("([a-f0-9]+)"\)/g);
        if (aMatch && aMatch.length >= 3) {
          const aHex = aMatch[0].match(/"([a-f0-9]+)"/)[1];
          const bHex = aMatch[1].match(/"([a-f0-9]+)"/)[1];
          const cHex = aMatch[2].match(/"([a-f0-9]+)"/)[1];

          const key = Buffer.from(aHex, 'hex');
          const iv = Buffer.from(bHex, 'hex');
          const ciphertext = Buffer.from(cHex, 'hex');

          // Decrypt to get the bypass cookie value
          const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
          decipher.setAutoPadding(false);
          let decrypted = decipher.update(ciphertext);
          decrypted = Buffer.concat([decrypted, decipher.final()]);
          
          const cookieVal = decrypted.toString('hex');
          this.cookieHeader = `__test=${cookieVal}`;
          console.log('[BuatQRIS Service] Cookie challenge solved successfully.');

          // Retry request with the bypass cookie
          headers['Cookie'] = this.cookieHeader;
          res = await fetch(this.apiUrl + '?i=1', {
            method: 'POST',
            headers: headers,
            body: new URLSearchParams(payload)
          });
          text = await res.text();
        } else {
          throw new Error('Failed to parse slowAES challenge parameters.');
        }
      }

      return JSON.parse(text);
    } catch (error) {
      console.error('[BuatQRIS Service] Request execution failed:', error.message);
      throw error;
    }
  }

  /**
   * Create a new QRIS payment invoice
   * @param {number} amount - Amount to be paid
   * @param {string} orderId - Unique order identifier
   * @param {string} callbackUrl - Webhook URL (deprecated/unused by BuatQRIS API)
   * @returns {Promise<{success: boolean, transaction_id: string, payment_url: string, amount: number, status: string}>}
   */
  async createTransaction(amount, orderId, callbackUrl) {
    console.log(`[BuatQRIS Service] Requesting payment creation. OrderID: ${orderId}, Amount: Rp ${amount}`);

    if (this.sandboxMode) {
      console.log(`[BuatQRIS Service] Sandbox mode active. Generating simulator payload.`);
      const mockTrxId = 'BQ-' + Math.random().toString(36).substring(2, 10).toUpperCase();
      const mockPaymentUrl = `/mock-payment/${mockTrxId}`;
      
      return {
        success: true,
        transaction_id: mockTrxId,
        payment_url: mockPaymentUrl,
        amount: amount,
        status: 'PENDING'
      };
    }

    try {
      const response = await this.sendRequest({
        action: 'api_create_qris',
        amount: amount.toString(),
        description: `Deposit ${orderId}`,
        qris_method: 'qris_two'
      });

      if (!response || !response.success) {
        throw new Error(response ? response.message : 'No response from BuatQRIS API');
      }

      console.log(`[BuatQRIS Service] API Success. Transaction ID: ${response.data.transaction_id}`);
      return {
        success: true,
        transaction_id: response.data.transaction_id,
        payment_url: response.data.payment_url,
        qr_url: response.data.qr_url || '',
        qris_image: response.data.qris_image || '',
        amount: amount,
        status: 'PENDING'
      };
    } catch (error) {
      console.error(`[BuatQRIS Service] API Request failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check status of a QRIS transaction
   * @param {string} transactionId - The transaction ID returned by createTransaction
   * @returns {Promise<{success: boolean, status: string}>}
   */
  async checkTransactionStatus(transactionId) {
    if (this.sandboxMode) {
      return { success: true, status: 'PENDING' };
    }

    try {
      const response = await this.sendRequest({
        action: 'api_check_status',
        transaction_id: transactionId
      });

      if (!response || !response.success) {
        throw new Error(response ? response.message : 'No response from BuatQRIS API');
      }

      return {
        success: true,
        status: response.data.status // pending | success | expired | failed
      };
    } catch (error) {
      console.error(`[BuatQRIS Service] Check status failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse withdraw status from BuatQRIS API response.
   * @param {object} response - Raw API JSON
   * @returns {'SUCCESS'|'PROCESS'|'FAILED'}
   */
  parseWithdrawStatus(response) {
    const raw = (response && response.data && response.data.status) || (response && response.status) || '';
    const s = String(raw).toLowerCase();
    if (['success', 'berhasil', 'done', 'completed'].includes(s)) return 'SUCCESS';
    if (['failed', 'gagal', 'error', 'rejected', 'cancelled'].includes(s)) return 'FAILED';
    if (['process', 'processing', 'pending', 'diproses', 'waiting'].includes(s)) return 'PROCESS';
    return 'PROCESS';
  }

  /**
   * Request withdrawal/disbursement via BuatQRIS api_withdraw
   * @param {number} amount - Amount to withdraw
   * @param {string} bankName - Bank or E-wallet name (e.g. Dana, OVO, GoPay)
   * @param {string} bankAccount - Target account number or phone number
   * @param {string} bankHolder - Account holder name
   * @returns {Promise<{success: boolean, message: string, status: string, data: object}>}
   */
  async createWithdrawal(amount, bankName, bankAccount, bankHolder) {
    console.log(`[BuatQRIS Service] Withdraw request. Amount: Rp ${amount}, Bank: ${bankName}, Account: ${bankAccount}`);

    if (this.sandboxMode) {
      return {
        success: true,
        message: 'Simulasi penarikan berhasil diajukan.',
        status: 'PROCESS',
        data: { withdraw_id: 'WD-SIM-' + Date.now() }
      };
    }

    try {
      const response = await this.sendRequest({
        action: 'api_withdraw',
        amount: amount.toString(),
        bank_name: bankName,
        bank_account: bankAccount,
        bank_holder: bankHolder
      });

      if (!response || !response.success) {
        const errMsg = response ? response.message : 'No response from BuatQRIS API';
        return {
          success: false,
          message: errMsg,
          status: 'FAILED',
          data: (response && response.data) || {}
        };
      }

      const status = this.parseWithdrawStatus(response);
      console.log(`[BuatQRIS Service] Withdraw API OK. Status: ${status}`);

      return {
        success: true,
        message: response.message || 'Penarikan berhasil diajukan.',
        status: status,
        data: response.data || {}
      };
    } catch (error) {
      console.error(`[BuatQRIS Service] Withdrawal request failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify the signature of incoming webhooks from BuatQRIS.site
   * @param {object|string} payload - The request body payload
   * @param {string} signature - The signature header (e.g. x-signature)
   * @returns {boolean}
   */
  verifyWebhookSignature(payload, signature) {
    if (this.sandboxMode || !this.signingSecret) {
      console.log(`[BuatQRIS Service] Webhook signature verification bypassed (Sandbox or missing Signing Secret).`);
      return true;
    }

    if (!signature) {
      console.warn(`[BuatQRIS Service] Webhook verification failed: Signature header is missing.`);
      return false;
    }

    try {
      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const computedSignature = crypto
        .createHmac('sha256', this.signingSecret)
        .update(payloadString)
        .digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(computedSignature, 'hex'),
        Buffer.from(signature, 'hex')
      );

      console.log(`[BuatQRIS Service] Webhook signature verification result: ${isValid}`);
      return isValid;
    } catch (error) {
      console.error(`[BuatQRIS Service] Signature verification failed with error:`, error.message);
      return false;
    }
  }
}

module.exports = BuatQRISService;
