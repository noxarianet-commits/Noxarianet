const readline = require('readline');
const fs = require('fs');
const path = require('path');
const OrderKuota = require('./src/OrderKuota');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => {
    return new Promise((resolve) => rl.question(query, resolve));
};

(async () => {
    try {
        console.log("=== LOGIN INTERAKTIF ORDER KUOTA ===\n");

        const username = await askQuestion("Masukkan Username / No HP Order Kuota: ");
        const password = await askQuestion("Masukkan Password Order Kuota: ");

        const orderkuota = new OrderKuota();

        console.log("\n[1/2] Mengirim permintaan login & request OTP...");
        const loginRes = await orderkuota.loginRequest(username, password);
        console.log("Respon Server:", loginRes);

        if (loginRes && loginRes.success === false) {
            console.log("\n❌ Gagal. Periksa kembali username dan password Anda.");
            rl.close();
            return;
        }

        console.log("\n✅ Request berhasil! Silakan cek Email Anda untuk kode OTP.");
        const otp = await askQuestion("\nMasukkan Kode OTP dari Email: ");

        console.log("\n[2/2] Memverifikasi OTP & mengambil Auth Token...");
        const tokenRes = await orderkuota.getAuthToken(username, otp);

        if (tokenRes && tokenRes.results && tokenRes.results.token) {
            const token = tokenRes.results.token;
            const user = tokenRes.results.username || username;

            console.log("\n🎉 BERHASIL!");
            console.log("-----------------------------------------");
            console.log(`Username   : ${user}`);
            console.log(`Auth Token : ${token}`);
            console.log("-----------------------------------------");

            // Simpan otomatis ke config.json
            const configPath = path.join(__dirname, 'config.json');
            fs.writeFileSync(configPath, JSON.stringify({ username: user, token: token }, null, 2));
            console.log("\n✅ Credentials berhasil disimpan otomatis ke `config.json`!");
            console.log("Sekarang Anda bisa langsung menjalankan server dengan command: npm start");
        } else {
            console.log("\n❌ Gagal verifikasi OTP:", tokenRes);
        }

    } catch (error) {
        console.error("\n❌ Terjadi kesalahan:", error);
    } finally {
        rl.close();
    }
})();
