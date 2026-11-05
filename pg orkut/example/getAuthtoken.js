const readline = require('readline');
const OrderKuota = require('../src/OrderKuota');

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

        console.log("\n[1/2] Mengirim permintaan login & OTP ke email...");
        const loginRes = await orderkuota.loginRequest(username, password);
        console.log("Respon Server:", loginRes);

        if (loginRes && loginRes.success === false) {
            console.log("\n❌ Gagal mengirim OTP. Periksa username dan password Anda.");
            rl.close();
            return;
        }

        console.log("\n✅ OTP berhasil dikirim ke Email Anda!");
        const otp = await askQuestion("Masukkan Kode OTP dari Email: ");

        console.log("\n[2/2] Verifikasi OTP & Mengambil Auth Token...");
        const tokenRes = await orderkuota.getAuthToken(username, otp);
        console.log("Respon Server:", tokenRes);

        if (tokenRes && tokenRes.token) {
            console.log("\n🎉 BERHASIL LOGIN!");
            console.log("-----------------------------------------");
            console.log(`Username   : ${username}`);
            console.log(`Auth Token : ${tokenRes.token}`);
            console.log("-----------------------------------------");
            console.log("Simpan Auth Token di atas untuk digunakan di Example.js!");
        } else if (tokenRes && tokenRes.message) {
            console.log(`\n❌ Gagal: ${tokenRes.message}`);
        }

    } catch (error) {
        console.error("\n❌ Terjadi kesalahan:", error);
    } finally {
        rl.close();
    }
})();
