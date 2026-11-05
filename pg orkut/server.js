const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OrderKuota = require('./src/OrderKuota');
const QrisDynamic = require('./src/QrisDynamic');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Paths
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DB_PATH = path.join(__dirname, 'transactions.json');

// Helper DB Transactions
function getTransactions() {
    if (fs.existsSync(DB_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        } catch (e) {
            return [];
        }
    }
    return [];
}

function saveTransactions(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getCredentials() {
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch (e) {
            return {};
        }
    }
    return {};
}

// ----------------------------------------------------
// 1. ENDPOINT HOME / DASHBOARD STATUS
// ----------------------------------------------------
app.get('/', (req, res) => {
    const creds = getCredentials();
    const transactions = getTransactions();
    res.json({
        status: 'Online',
        service: 'OrderKuota Payment Gateway Engine',
        account: {
            username: creds.username || 'Belum diisi',
            tokenStatus: creds.token ? 'Tersedia' : 'Belum diisi'
        },
        stats: {
            totalTransactions: transactions.length,
            pending: transactions.filter(t => t.status === 'PENDING').length,
            paid: transactions.filter(t => t.status === 'PAID').length
        },
        endpoints: {
            createPayment: 'POST /api/payment/create',
            checkStatus: 'GET /api/payment/status/:invoice_id',
            listPayments: 'GET /api/payment/list'
        }
    });
});

// ----------------------------------------------------
// 2. ENDPOINT CREATE INVOICE / PAYMENT GATEWAY
// ----------------------------------------------------
app.post('/api/payment/create', async (req, res) => {
    try {
        const { amount, order_id, customer_name, callback_url } = req.body;

        if (!amount || isNaN(amount) || amount < 1000) {
            return res.status(400).json({
                success: false,
                message: 'Parameter `amount` wajib diisi dan minimal Rp 1.000.'
            });
        }

        const creds = getCredentials();
        if (!creds.username || !creds.token) {
            return res.status(400).json({
                success: false,
                message: 'Credentials OrderKuota belum dikonfigurasi. Jalankan `node login.js`.'
            });
        }

        // Ambil URL QRIS dari OrderKuota
        const orderkuota = new OrderKuota(creds.username, creds.token);
        const accountData = await orderkuota.getTransactionQris();

        let qrisUrl = "https://qris.orderkuota.com/qrnobu/2804506-ee611babcaa4fd7765b984ec3958142a2f844f78-QR.png"; // Fallback URL QRIS Anda
        if (accountData && accountData.account && accountData.account.results && accountData.account.results.qris) {
            qrisUrl = accountData.account.results.qris;
        }

        // Buat Kode Unik (3 digit acak 100-999) untuk identifikasi pembayaran otomatis
        const uniqueCode = Math.floor(Math.random() * 899) + 100;
        const totalAmount = parseInt(amount) + uniqueCode;
        const invoiceId = 'INV-' + Date.now() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();

        const now = new Date();
        const expiredAt = new Date(now.getTime() + 15 * 60 * 1000); // Expire dalam 15 menit

        // Generate Dynamic QRIS Image (Nominal Otomatis Terisi saat di Scan!)
        let dynamicQrData = null;
        try {
            dynamicQrData = await QrisDynamic.generateDynamicQrisImage(qrisUrl, totalAmount);
        } catch (qrErr) {
            console.error("[QRIS DYNAMIC ERROR]", qrErr.message);
        }

        const finalQrisImage = dynamicQrData ? dynamicQrData.qrImage : qrisUrl;
        const qrisPayload = dynamicQrData ? dynamicQrData.payload : null;

        const newTransaction = {
            invoice_id: invoiceId,
            order_id: order_id || invoiceId,
            customer_name: customer_name || 'Pelanggan',
            nominal_awal: parseInt(amount),
            kode_unik: uniqueCode,
            total_amount: totalAmount,
            status: 'PENDING',
            qris_image: finalQrisImage,
            qris_payload: qrisPayload,
            callback_url: callback_url || null,
            created_at: now.toISOString(),
            expired_at: expiredAt.toISOString()
        };

        const db = getTransactions();
        db.push(newTransaction);
        saveTransactions(db);

        res.json({
            success: true,
            message: 'Invoice Payment QRIS Dinamis berhasil dibuat',
            data: {
                invoice_id: newTransaction.invoice_id,
                order_id: newTransaction.order_id,
                customer_name: newTransaction.customer_name,
                nominal_asli: newTransaction.nominal_awal,
                kode_unik: newTransaction.kode_unik,
                total_bayar: newTransaction.total_amount,
                status: newTransaction.status,
                is_dynamic: true,
                qris_url: newTransaction.qris_image,
                qris_payload: newTransaction.qris_payload,
                expired_at: newTransaction.expired_at,
                instruksi: `Scan QRIS di atas. Nominal Rp ${totalAmount.toLocaleString('id-ID')} akan OTOMATIS TERISI & TERKUNCI di aplikasi m-Banking/e-Wallet Anda!`
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Gagal membuat pembayaran',
            error: error
        });
    }
});

// ----------------------------------------------------
// 3. ENDPOINT CEK STATUS INVOICE BY ID
// ----------------------------------------------------
app.get('/api/payment/status/:invoice_id', (req, res) => {
    const { invoice_id } = req.params;
    const db = getTransactions();
    const tx = db.find(t => t.invoice_id === invoice_id || t.order_id === invoice_id);

    if (!tx) {
        return res.status(404).json({
            success: false,
            message: 'Invoice tidak ditemukan.'
        });
    }

    res.json({
        success: true,
        data: tx
    });
});

// ----------------------------------------------------
// 4. ENDPOINT LIST SEMUA TRANSAKSI
// ----------------------------------------------------
app.get('/api/payment/list', (req, res) => {
    const db = getTransactions();
    res.json({
        success: true,
        total: db.length,
        data: db
    });
});

// ----------------------------------------------------
// 5. AUTOMATED MUTATION CHECKER (CRON CHECKER AUTO-PAID)
// ----------------------------------------------------
let lastQrisBalance = null;

async function checkMutations() {
    const creds = getCredentials();
    if (!creds.username || !creds.token) return;

    try {
        const orderkuota = new OrderKuota(creds.username, creds.token);
        const data = await orderkuota.getTransactionQris();

        if (data && data.account && data.account.results) {
            const currentQrisBalance = parseInt(data.account.results.qris_balance || 0);

            // Cek transaksi PENDING yang sudah expired
            const db = getTransactions();
            const now = new Date();
            let updated = false;

            db.forEach(tx => {
                if (tx.status === 'PENDING' && new Date(tx.expired_at) < now) {
                    tx.status = 'EXPIRED';
                    updated = true;
                    console.log(`[EXPIRED] Invoice ${tx.invoice_id} telah kedaluwarsa.`);
                }
            });

            // Jika ada perubahan saldo QRIS atau pemeriksaan rutin
            if (lastQrisBalance !== null && currentQrisBalance > lastQrisBalance) {
                const selisih = currentQrisBalance - lastQrisBalance;
                console.log(`[MUTASI MASUK] Terdeteksi penambahan saldo QRIS sebesar Rp ${selisih.toLocaleString('id-ID')}`);

                // Cari transaksi PENDING yang total_amount nya cocok dengan selisih saldo
                const matchedTx = db.find(t => t.status === 'PENDING' && t.total_amount === selisih);

                if (matchedTx) {
                    matchedTx.status = 'PAID';
                    matchedTx.paid_at = now.toISOString();
                    updated = true;
                    console.log(`🎉 [PAYMENT SUCCESS] Invoice ${matchedTx.invoice_id} (Rp ${matchedTx.total_amount}) BERHASIL DIBAYAR!`);

                    // Trigger Callback URL jika ada
                    if (matchedTx.callback_url) {
                        try {
                            fetch(matchedTx.callback_url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    event: 'payment.success',
                                    invoice_id: matchedTx.invoice_id,
                                    order_id: matchedTx.order_id,
                                    amount: matchedTx.total_amount,
                                    status: 'PAID',
                                    paid_at: matchedTx.paid_at
                                })
                            }).then(() => console.log(`[CALLBACK SENT] Webhook dikirim ke ${matchedTx.callback_url}`))
                              .catch(err => console.error(`[CALLBACK FAILED] ${err.message}`));
                        } catch (e) {}
                    }
                }
            }

            lastQrisBalance = currentQrisBalance;

            if (updated) {
                saveTransactions(db);
            }
        }
    } catch (error) {
        console.error("[CHECKER ERROR]", error.message || error);
    }
}

// Jalankan Checker Mutasi Otomatis setiap 15 detik
setInterval(checkMutations, 15000);

app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🚀 OrderKuota Payment Gateway Engine Aktif!`);
    console.log(`🌐 Server URL               : http://localhost:${PORT}`);
    console.log(`💳 Endpoint Create Payment  : POST http://localhost:${PORT}/api/payment/create`);
    console.log(`🔍 Endpoint Check Status    : GET http://localhost:${PORT}/api/payment/status/:invoice_id`);
    console.log(`🔄 Auto Mutasi Checker      : Aktif (Setiap 15 detik)`);
    console.log(`==================================================\n`);
});
