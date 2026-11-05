# 🚀 OrderKuota Payment Gateway & API (Node.js)

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-v4.19.2-blue.svg)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-brightgreen.svg)](LICENSE)
[![QRIS Dynamic](https://img.shields.io/badge/QRIS-Dynamic%20EMVCo-orange.svg)](#-cara-kerja-qris-dinamis)

Library dan Engine **Payment Gateway QRIS Dinamis Unofficial** untuk **Order Kuota** berbasis Node.js. Proyek ini mengubah QRIS Statis Order Kuota menjadi **QRIS Dinamis (Nominal Otomatis Terisi & Terkunci)** serta dilengkapi dengan **Auto Mutation Checker** (Deteksi Pembayaran Otomatis) dan **Webhook Callback**.

---

## ✨ Fitur Utama

- ⚡ **QRIS Dinamis Otomatis**: Generasi payload EMVCo QRIS dinamis secara otomatis. Saat pembeli scan QRIS, nominal (sampai kode unik 3 digit) langsung terisi & terkunci di aplikasi m-Banking/e-Wallet.
- 🔄 **Auto Mutation Checker**: Background task mengecek mutasi saldo QRIS masuk secara otomatis setiap 15 detik.
- 🔔 **Webhook Callback Notification**: Mengirimkan notifikasi HTTP POST otomatis ke URL website Anda ketika pembayaran lunas.
- 🔐 **Login Interaktif Terminal (CLI)**: Kemudahan mendapatkan `auth_token` melalui terminal interaktif dengan pengiriman OTP ke email.
- 🌐 **REST API & Dashboard Checkout**: Disertai Web Server Express.js dan tampilan checkout demo kasir modern.
- 🛠️ **Tanpa Dependency Berat**: Hanya menggunakan modul Node.js standar + `express`, `qrcode`, `jsqr`, dan `pngjs`.

---

## 📁 Struktur Proyek

```text
orderkuota-api/
├── config.json              # Menyimpan username & auth_token secara aman
├── transactions.json        # Database penyimpanan invoice & status transaksi
├── package.json             # Dependensi & script Node.js
├── server.js                # Engine utama Express API & Auto Mutation Checker
├── login.js                 # Script login interaktif CLI (Request OTP & Token)
├── Example.js               # Contoh pengujian dasar API OrderKuota
├── README.md                # Dokumentasi proyek
├── src/
│   ├── OrderKuota.js        # Core HTTP Client OrderKuota API
│   └── QrisDynamic.js       # Engine Konversi QRIS Statis -> Dinamis (EMVCo CRC16)
├── public/
│   └── index.html           # Halaman Web Demo Checkout QRIS Kasir
└── example/
    ├── getAuthtoken.js      # Contoh login interaktif
    └── getHistoryQris.js    # Contoh mengambil riwayat QRIS
```

---

## 🛠️ Instalasi & Persiapan

1. Pastikan Anda sudah menginstal **Node.js (v18 atau lebih baru)**.
2. Buka terminal di folder proyek ini dan install dependensi:
   ```bash
   npm install
   ```

---

## 🔐 1. Langkah Pertama: Login & Ambil Auth Token

Sebelum menjalankan server API, Anda perlu mengambil `auth_token` akun Order Kuota Anda secara interaktif:

```bash
npm run login
```
*(atau `node login.js`)*

**Alur Login Interaktif:**
1. Masukkan **Username / No HP** akun Order Kuota Anda.
2. Masukkan **Password** akun Order Kuota Anda.
3. Cek **Kode OTP** yang dikirimkan ke Email Anda.
4. Masukkan Kode OTP di terminal.
5. `auth_token` akan **otomatis tersimpan ke file `config.json`**.

---

## 🚀 2. Menjalankan Server Payment Gateway

Untuk menjalankan Web Server API & Auto Mutation Checker:

```bash
npm start
```

Server akan aktif di: **`http://localhost:3000`**

Buka browser dan buka `http://localhost:3000` untuk mencoba **Halaman Demo Checkout QRIS**.

---

## 📚 Dokumentasi API Endpoints

### 1. Membuat Tagihan Pembayaran QRIS Dinamis (`POST /api/payment/create`)

Panggil endpoint ini dari website/toko online Anda saat pembeli ingin melakukan pembayaran.

- **URL**: `POST http://localhost:3000/api/payment/create`
- **Header**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "amount": 10000,
  "order_id": "ORDER-10023",
  "customer_name": "Andika Anwar",
  "callback_url": "https://website-anda.com/api/webhook"
}
```

- **Response Body**:
```json
{
  "success": true,
  "message": "Invoice Payment QRIS Dinamis berhasil dibuat",
  "data": {
    "invoice_id": "INV-1723102-A8F1",
    "order_id": "ORDER-10023",
    "customer_name": "Andika Anwar",
    "nominal_asli": 10000,
    "kode_unik": 342,
    "total_bayar": 10342,
    "status": "PENDING",
    "is_dynamic": true,
    "qris_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwA...",
    "qris_payload": "00020101021226670016COM.NOBUBANK.WWW...540510342...630420A5",
    "expired_at": "2026-08-08T07:30:00.000Z",
    "instruksi": "Scan QRIS di atas. Nominal Rp 10.342 akan OTOMATIS TERISI & TERKUNCI di aplikasi m-Banking/e-Wallet Anda!"
  }
}
```

---

### 2. Mengecek Status Invoice (`GET /api/payment/status/:invoice_id`)

Gunakan endpoint ini untuk mengecek status pembayaran invoice secara berkala dari frontend (polling).

- **URL**: `GET http://localhost:3000/api/payment/status/INV-1723102-A8F1`
- **Response Body**:
```json
{
  "success": true,
  "data": {
    "invoice_id": "INV-1723102-A8F1",
    "order_id": "ORDER-10023",
    "customer_name": "Andika Anwar",
    "nominal_awal": 10000,
    "kode_unik": 342,
    "total_amount": 10342,
    "status": "PAID",
    "paid_at": "2026-08-08T07:25:10.000Z"
  }
}
```

---

### 3. Webhook Callback (Notifikasi Otomatis Ke Website Anda)

Jika Anda menyertakan parameter `callback_url` saat membuat payment, server ini akan **otomatis mengirimkan HTTP POST** ke URL tersebut saat pembayaran lunas terdeteksi:

- **Method**: `POST`
- **Body JSON**:
```json
{
  "event": "payment.success",
  "invoice_id": "INV-1723102-A8F1",
  "order_id": "ORDER-10023",
  "amount": 10342,
  "status": "PAID",
  "paid_at": "2026-08-08T07:25:10.000Z"
}
```

---

### 4. Daftar Semua Transaksi (`GET /api/payment/list`)

Melihat semua riwayat transaksi yang tersimpan di sistem.

- **URL**: `GET http://localhost:3000/api/payment/list`

---

### 5. Cek Informasi Akun & Saldo QRIS (`GET /api/qris-history`)

Mengambil data raw akun dan saldo QRIS dari server Order Kuota.

- **URL**: `GET http://localhost:3000/api/qris-history`

---

### 6. Penarikan Saldo QRIS / Withdraw (`POST /api/withdraw`)

Melakukan penarikan saldo QRIS ke saldo akun utama.

- **URL**: `POST http://localhost:3000/api/withdraw`
- **Request Body**:
```json
{
  "amount": 10000
}
```

---

## 🔬 Cara Kerja QRIS Dinamis (Spesifikasi EMVCo)

Order Kuota secara bawaan hanya menyediakan gambar QRIS Statis. Modul `src/QrisDynamic.js` melakukan transformasi EMVCo standar berikut secara real-time:

1. **Decoding QRIS**: Membaca string EMVCo dari gambar QRIS Order Kuota (`000201010211...`).
2. **Pengubahan Tipe Payload**: Mengubah Tag `01` dari `010211` (Statis) menjadi `010212` (Dinamis).
3. **Penyisipan Nominal (Tag 54)**: Menyisipkan Tag `54` berisi nominal tepat beserta kode unik (contoh: `540510342` untuk Rp 10.342).
4. **Kalkulasi Checksum (CRC16)**: Menghitung ulang checksum CRC16-CCITT (Polynomial `0x1021`, Initial `0xFFFF`) di bagian Tag `6304`.
5. **Generasi QR Code Baru**: Membaca kembali string EMVCo hasil modifikasi menjadi gambar QR Code Base64.

---

## 📜 Lisensi & Penafian (Disclaimer)

- Proyek ini didistribusikan di bawah **Lisensi MIT**.
- **Disclaimer**: Kode ini disediakan "sebagaimana adanya" tanpa jaminan apapun. Penggunaan kode ini sepenuhnya merupakan risiko pengguna sendiri. Pembuat dan kontributor tidak bertanggung jawab atas kerugian atau konsekuensi apapun akibat penggunaan kode ini. Proyek ini tidak berafiliasi secara resmi dengan Order Kuota.
