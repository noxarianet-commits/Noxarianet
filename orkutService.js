const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const OrderKuota = require('./pg orkut/src/OrderKuota');
const QrisDynamic = require('./pg orkut/src/QrisDynamic');

const CONFIG_PATH = path.join(__dirname, 'pg orkut', 'config.json');

class OrkutService {
  constructor() {
    this.lastQrisBalance = null;
  }

  getCredentials() {
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      } catch (e) {
        console.error('[OrkutService] Error reading config.json:', e.message);
      }
    }
    return { username: '', token: '' };
  }

  async getQrisInfo() {
    const creds = this.getCredentials();
    if (!creds.username || !creds.token) {
      throw new Error('OrderKuota credentials belum dikonfigurasi.');
    }
    const orderkuota = new OrderKuota(creds.username, creds.token);
    return await orderkuota.getTransactionQris();
  }

  async createTopupOrder({ amount, userId, username }) {
    const numericAmount = Math.ceil(parseInt(amount, 10));
    if (isNaN(numericAmount) || numericAmount < 1000) {
      throw new Error('Nominal top-up minimal Rp 1.000.');
    }

    const creds = this.getCredentials();
    let qrisUrl = 'https://qris.orderkuota.com/qrnobu/2804506-ee611babcaa4fd7765b984ec3958142a2f844f78-QR.png';

    if (creds.username && creds.token) {
      try {
        const orderkuota = new OrderKuota(creds.username, creds.token);
        const accountData = await orderkuota.getTransactionQris();
        if (accountData && accountData.account && accountData.account.results && accountData.account.results.qris) {
          qrisUrl = accountData.account.results.qris;
        }
      } catch (err) {
        console.log('[OrkutService Note]: OrderKuota API failed, using standard QRIS fallback.');
      }
    }

    // Generate kode unik (100 - 999)
    const uniqueCode = Math.floor(Math.random() * 899) + 100;
    const totalAmount = numericAmount + uniqueCode;

    const timestamp = Date.now();
    const refId = `TOPUP_${userId || username}_${timestamp}`;
    const invoiceId = `INV-ORK-${timestamp}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const expiredAt = new Date(timestamp + (15 * 60 * 1000)).toISOString(); // 15 menit expired

    let dynamicQrData = null;
    try {
      dynamicQrData = await QrisDynamic.generateDynamicQrisImage(qrisUrl, totalAmount);
    } catch (qrErr) {
      console.error('[OrkutService] QRIS Dynamic Generation Note:', qrErr.message);
    }

    // Fallback QR code URL if dynamic QR image generation fails
    const finalQrImage = (dynamicQrData && dynamicQrData.qrImage)
      ? dynamicQrData.qrImage
      : `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent('00020101021226680016ID.CO.QRIS.WWW01189360088812345678900215ID10203948291020303UMI5204581253033605802ID5915NOXAPAY WALLET6007JAKARTA6304')}`;
    const qrisPayload = dynamicQrData ? dynamicQrData.payload : '';

    return {
      success: true,
      ref_id: refId,
      invoice: invoiceId,
      user_id: userId || username,
      username: username || userId,
      nominal_awal: numericAmount,
      kode_unik: uniqueCode,
      total_amount: totalAmount,
      amount: totalAmount,
      fees: 0,
      payment_code: 'QRIS_ORKUT',
      status: 'pending',
      qr_link: finalQrImage,
      qr_url: finalQrImage,
      qris_payload: qrisPayload,
      payment_link: '',
      expired_at: expiredAt,
      created_at: new Date(timestamp).toISOString(),
      updated_at: new Date(timestamp).toISOString()
    };
  }

  async checkMutations(topupFile, usersFile, dbHelper, updateUserSaldoFn) {
    const creds = this.getCredentials();
    if (!creds.username || !creds.token) return;

    try {
      const orderkuota = new OrderKuota(creds.username, creds.token);
      const data = await orderkuota.getTransactionQris();

      if (data && data.account && data.account.results) {
        const currentQrisBalance = parseInt(data.account.results.qris_balance || 0, 10);

        // Read topups
        let topups = [];
        if (fs.existsSync(topupFile)) {
          try {
            topups = JSON.parse(fs.readFileSync(topupFile, 'utf8') || '[]');
          } catch (e) {
            topups = [];
          }
        }

        const now = new Date();
        let updated = false;

        // 1. Mark expired pending transactions
        topups.forEach(tx => {
          if ((tx.status === 'pending' || tx.status === 'PENDING') && tx.expired_at && new Date(tx.expired_at) < now) {
            tx.status = 'expired';
            tx.updated_at = now.toISOString();
            updated = true;
            if (dbHelper && dbHelper.updatePaymentStatus) {
              dbHelper.updatePaymentStatus(tx.ref_id, 'EXPIRED');
            }
            console.log(`[Orkut Mutation] Invoice ${tx.ref_id} (${tx.invoice}) expired.`);
          }
        });

        // 2. Check incoming balance
        if (this.lastQrisBalance !== null && currentQrisBalance > this.lastQrisBalance) {
          const selisih = currentQrisBalance - this.lastQrisBalance;
          console.log(`💰 [Orkut Mutation] Penambahan saldo QRIS terdeteksi: Rp ${selisih.toLocaleString('id-ID')}`);

          // Find pending topup matching total_amount (khusus non-FinCloud)
          const matchedTx = topups.find(t => t.provider !== 'FINCLOUD' && t.payment_code !== 'QRIS_FINCLOUD' && (t.status === 'pending' || t.status === 'PENDING') && (t.total_amount === selisih || t.amount === selisih));

          if (matchedTx) {
            matchedTx.status = 'paid';
            matchedTx.paid_at = now.toISOString();
            matchedTx.updated_at = now.toISOString();
            updated = true;

            const targetUser = matchedTx.username || matchedTx.user_id;
            const creditAmount = matchedTx.nominal_awal || matchedTx.amount;

            console.log(`🎉 [PAYMENT SUCCESS] Invoice ${matchedTx.invoice} / ${matchedTx.ref_id} Rp ${creditAmount} BERHASIL DIBAYAR! User: ${targetUser}`);

            // Catat status invoice pembayaran (TIDAK MENAMBAH SALDO OTOMATIS: Semua saldo diatur manual oleh admin)
            if (dbHelper) {
              try {
                await dbHelper.updatePaymentStatus(matchedTx.ref_id, 'WAITING_APPROVAL');
                console.log(`[Orkut Mutation] Invoice ${matchedTx.ref_id} (${targetUser}) tercatat WAITING_APPROVAL. Menunggu persetujuan manual Admin.`);
              } catch (dbErr) {
                console.error('[Orkut Mutation] DB Update Error:', dbErr.message);
              }
            }
          }
        }

        this.lastQrisBalance = currentQrisBalance;

        if (updated) {
          fs.writeFileSync(topupFile, JSON.stringify(topups, null, 2), 'utf8');
        }
      }
    } catch (error) {
      console.error('[Orkut Mutation Error]:', error.message || error);
    }
  }
}

module.exports = new OrkutService();
