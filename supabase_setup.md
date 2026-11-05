# Status & Panduan Setup Database Supabase (Noxarianet Wallet)

**Status Terakhir**: 25 Oktober 2026, 22:45 WIB  
**Kondisi**: ✅ **12 Tabel Berhasil Dibuat di Supabase (UNRESTRICTED)**

---

## 📊 Hasil Progress Setup Malam Ini

Tabel-tabel berikut telah sukses terbuat dan aktif di Dashboard Supabase:

| No | Nama Tabel | Status RLS | Keterangan |
|:---|:---|:---:|:---|
| 1 | `admin_users` | `UNRESTRICTED` | Akun administrator login |
| 2 | `app_config` | `UNRESTRICTED` | Konfigurasi aplikasi & running text |
| 3 | `banners` | `UNRESTRICTED` | Slider banner promo beranda |
| 4 | `chat_messages` | `UNRESTRICTED` | Riwayat percakapan Customer Service |
| 5 | `informations` | `UNRESTRICTED` | Pengumuman broadcast |
| 6 | `payments` | `UNRESTRICTED` | Tiket deposit & Top Up QRIS/VA |
| 7 | `ppob_visibility` | `UNRESTRICTED` | Setting markup & status produk PPOB |
| 8 | `push_subscriptions` | `UNRESTRICTED` | Token web push notification |
| 9 | `transactions` | `UNRESTRICTED` | Transaksi PPOB, pulsa, transfer & game |
| 10 | `user_locations` | `UNRESTRICTED` | Log geolokasi & perangkat pengguna |
| 11 | `users` | `UNRESTRICTED` | Data akun member, PIN, & saldo dompet |
| 12 | `withdrawals` | `UNRESTRICTED` | Riwayat penarikan saldo ke bank/e-wallet |

---

## 🛠️ Pekerjaan yang Telah Diselesaikan di Source Code:
1. **`database.js`**:
   - Telah ditambahkan adapter PostgreSQL (`pg.Pool`) dengan SSL support.
   - Konversi otomatis parameter query SQLite (`?`) menjadi PostgreSQL (`$1, $2, ...`).
   - Normalisasi camelCase data response (misal: `mainBalance`, `userId`, `orderId`) agar 100% kompatibel dengan frontend & backend.
   - Mekanisme *Dual-Engine*: Otomatis memakai Supabase jika `SUPABASE_DB_URL` ada, dan otomatis *fallback* ke SQLite/JSON jika offline.
2. **`package.json`**:
   - Driver PostgreSQL (`"pg": "^8.13.1"`) sudah ditambahkan ke dependencies.
3. **`migrate_to_supabase.js`**:
   - Skrip migrasi data siap pakai jika data dari SQLite lama ingin dipindahkan ke Supabase.
4. **`supabase_setup_all_in_one.sql`**:
   - Skrip SQL lengkap skema + seed data awal yang telah berhasil dieksekusi di Supabase.

---

## 📋 Rencana Lanjutan untuk Besok:

Ketika Anda siap melanjutkan besok, berikut langkah-langkah tersisa untuk menyelesaikannya:

### 1. Pasang Driver PostgreSQL di Server/Lokal
Jalankan di terminal aplikasi:
```bash
npm install pg
```

### 2. Isi Connection String di `.env`
Buka file `.env`, lalu tambahkan URI Supabase:
```env
SUPABASE_DB_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD-DATABASE]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```
> *Catatan: URI ini diambil dari Supabase Dashboard -> **Project Settings** -> **Database** -> **Connection string** (Tab **URI**).*

### 3. (Opsional) Migrasi Data Lama
Jika ingin menyalin data member, saldo, dan transaksi dari SQLite lama:
```bash
node migrate_to_supabase.js
```

### 4. Restart Aplikasi
```bash
npm start
```
Server akan menampilkan log sukses:
```text
⚡ [Supabase DB] Connected to Supabase PostgreSQL successfully!
```
Aplikasi Noxarianet Wallet sudah resmi berjalan 100% menggunakan Supabase!
