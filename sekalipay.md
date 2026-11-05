# Dokumentasi API Reseller SekaliPay

**API Version:** v1.0 (Latest)

---

## Daftar Isi

1. [Overview](#overview)
2. [Base URL](#base-url)
3. [Authentication](#authentication)
4. [Order Process Types](#order-process-types)
5. [Balance Endpoints](#balance-endpoints)
   - [Get Balance](#get-balance)
   - [Top Up Balance](#top-up-balance)
   - [Payment Channels](#payment-channels)
   - [Balance Mutations](#balance-mutations)
6. [Items Endpoints](#items-endpoints)
   - [List Items](#list-items)
   - [Item Detail](#item-detail)
   - [Account Validation](#account-validation)
   - [Stock Lock](#stock-lock)
7. [Transactions Endpoints](#transactions-endpoints)
   - [List Transactions](#list-transactions)
   - [Create Transaction](#create-transaction)
   - [Transaction Detail](#transaction-detail)
   - [Bayar Tagihan (Pascabayar)](#bayar-tagihan-pascabayar)
8. [Leaderboard Endpoints](#leaderboard-endpoints)
   - [Top 10 Reseller](#top-10-reseller)
   - [My Ranking](#my-ranking)
9. [Testing Endpoints](#testing-endpoints)
   - [Sandbox Order](#sandbox-order)
10. [Webhook](#webhook)
    - [Configuration](#webhook-configuration)
    - [Events & Payload](#webhook-events--payload)
    - [Signature Verification](#webhook-signature-verification)
11. [Error Codes](#error-codes)
12. [Support](#support)

---

## Overview

Selamat datang di dokumentasi API Reseller SekaliPay. API ini memungkinkan Anda untuk mengintegrasikan layanan kami ke dalam aplikasi atau sistem Anda secara langsung.

---

## Base URL

```
https://sekalipay.com/api
```

---

## Authentication

Semua request ke API harus menyertakan API Key untuk autentikasi. Selain itu, IP address server Anda harus terdaftar di whitelist.

### Headers

| Header | Nilai | Wajib |
|--------|-------|-------|
| `X-APIKEY` | API Key Anda | Required |
| `Accept` | application/json | Required |
| `Content-Type` | application/json | POST only |

### Cara Mendapatkan API Key

Login ke dashboard reseller, buka menu Settings/API, dan copy API Key Anda.

### IP Whitelist

Untuk keamanan, hanya request dari IP yang terdaftar yang akan diterima. Tambahkan IP server Anda di dashboard reseller.

> **Penting:** Jika IP Anda dinamis, pastikan untuk selalu update IP di dashboard.

### Authentication Errors

| Code | Description |
|------|-------------|
| `401 INVALID_API_KEY` | API Key tidak valid atau tidak ditemukan. |
| `401 ACCOUNT_MUST_BE_RESELLER` | Akun harus memiliki role reseller. |
| `401 INVALID_IP` | IP address tidak terdaftar di whitelist. |
| `403 THE_ACCOUNT_HAS_BEEN_SUSPENDED` | Akun telah di-suspend. |

### Example Request

```bash
curl --request GET \
  --url https://sekalipay.com/api/v1/balance \
  --header 'X-APIKEY: sk_live_xxxxx' \
  --header 'Accept: application/json'
```

---

## Order Process Types

Setiap item/variant memiliki `order_process` yang menentukan bagaimana pesanan diproses dan data apa yang akan dikembalikan.

### Process Types Overview

| Type | Description | Response Data |
|------|-------------|---------------|
| `auto` | Produk digital dengan stok (akun, lisensi, voucher) | `product_license`, `note` |
| `manual` | Produk yang diproses manual oleh admin | `note` (diisi setelah diproses) |
| `h2h` | Host-to-Host (Pulsa, Token PLN, PPOB) | `h2h_results` (sn, status) |
| `smm` | Social Media Marketing (followers, likes, views) | `smm_results` (order_id, status, remains) |

### Auto Process

Produk dengan stok yang sudah tersedia di sistem. Data produk (akun/lisensi) akan langsung dikirimkan setelah pembayaran berhasil.

**Contoh Produk:**
- Akun Premium (Netflix, Spotify, Canva)
- Lisensi Software
- Voucher Game
- Gift Card

**Response Fields:**
- `product_license` - Data akun/lisensi yang dikirimkan
- `note` - Catatan tambahan dari seller

### Manual Process

Produk yang memerlukan proses manual oleh admin. Status akan berubah setelah admin memproses pesanan dan mengisi data.

**Contoh Produk:**
- Jasa Desain
- Custom Order
- Produk yang perlu verifikasi

**Status Flow:** `pending` → `sent` → `completed`

**Webhook Event:** Untuk produk manual, webhook `order.item.sent` akan dikirim real-time ketika admin mengirimkan pesanan. Event ini dikirim **per-item**, bukan per-order.

#### order.item.sent Payload Example

```json
{
  "event": "order.item.sent",
  "timestamp": "2026-02-12T00:24:15+07:00",
  "data": {
    "invoice": "SPY1770830637OC8V",
    "ref_id": "INV-20260212-NQGYFI",
    "transaction_status": "paid",
    "item": {
      "order_item_id": "01kh6vpatp6yhphh181zz3a8qv",
      "variant_id": 9,
      "variant_name": "Ios 1 Bulan",
      "product_name": "Apple Music",
      "order_process": "manual",
      "quantity": 1,
      "price": 3325,
      "status": "sent",
      "note": "https://t.me/sekalipaych/4",
      "licenses": [
        {
          "product_license": "user@email.com|password123",
          "note": null
        }
      ],
      "sent_at": "2026-02-12T00:24:15+07:00"
    }
  }
}
```

### H2H Process (Host-to-Host)

Produk yang diproses otomatis melalui API host-to-host. Biasanya untuk produk PPOB seperti pulsa, token listrik, paket data.

**Contoh Produk:**
- Pulsa All Operator
- Token Listrik PLN
- Paket Data Internet
- Voucher Game
- E-Wallet

**Response Fields (h2h_results):**
| Field | Type | Description |
|-------|------|-------------|
| `h2h_provider` | string\|null | Nama source pemrosesan H2H |
| `provider_meta` | object\|null | Metadata capability item H2H |
| `variant_id` | integer | ID variant yang diproses |
| `sn` | string | Serial Number dari provider |
| `dispatch_status` | string | `completed` atau `failed` |
| `log_message` | string | Pesan dari provider |

> **⚠️ Handling Failed Transactions:** Jika `dispatch_status: "failed"`, field `sn` akan berisi pesan error seperti `"failed: Nomor tidak valid"`. Saldo akan otomatis dikembalikan.

### SMM Process (Social Media Marketing)

Produk SMM yang diproses melalui panel SMM. Proses berjalan bertahap dan status dapat dipantau melalui API.

**Contoh Produk:**
- Instagram Followers, Likes, Views
- TikTok Followers, Views, Likes
- YouTube Subscribers, Views, Likes

**Status Flow:** `Pending` → `In progress` → `Completed`

**Response Fields (smm_results):**
| Field | Type | Description |
|-------|------|-------------|
| `variant_id` | integer | ID variant yang diproses |
| `order_id` | string\|null | ID order dari SMM Panel |
| `status` | string | `Pending`, `In progress`, `Completed`, `Partial` |
| `start_count` | integer\|null | Jumlah awal sebelum order diproses |
| `remains` | integer\|null | Sisa yang belum diproses |
| `delivered_count` | integer\|null | Jumlah yang sudah berhasil diproses |
| `refund_amount` | integer\|null | Nominal refund parsial jika ada |

### Customer Data (Note)

Beberapa produk memerlukan data customer yang dikirim melalui field `note` saat membuat transaksi.

| Order Process | Note Content | Example |
|---------------|--------------|---------|
| `auto` | Opsional (catatan untuk seller) | `"Tolong pilih region SG"` |
| `manual` | Opsional (instruksi ke admin) | `"Email: user@mail.com"` |
| `h2h` | **WAJIB** - Nomor tujuan | `"08123456789"` |
| `smm` | **WAJIB** - Link/Username target | `"https://instagram.com/username"` |

---

## Balance Endpoints

### Get Balance

**GET** `/v1/balance`

Cek saldo akun reseller.

### Top Up Balance

**POST** `/v1/balance`

Top up saldo akun.

### Payment Channels

**GET** `/v1/balance/channels`

Mendapatkan daftar payment channels yang tersedia (QRIS, VA, Bank, dll).

### Balance Mutations

**GET** `/v1/balance/mutations`

Melihat riwayat mutasi saldo.

---

## Items Endpoints

### List Items

**GET** `/v1/item`

Dapatkan daftar semua item/produk yang tersedia untuk dijual. Termasuk informasi harga reseller, stok, dan kategori.

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | integer | Optional. Nomor halaman untuk pagination. |
| `per_page` | integer\|string | Optional. Jumlah item per halaman (default: 100, max: 500). Gunakan `"all"` untuk mendapatkan semua item dalam 1 request. |
| `updated_since` | string | Optional. ISO 8601 timestamp. Hanya return item yang diupdate setelah waktu ini. |
| `category` | string | Optional. Filter by category slug. |
| `search` | string | Optional. Cari berdasarkan nama produk. |

#### Response Item Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | ID unik item. |
| `name` | string | Nama item/variant. |
| `price` | integer | Harga reseller dalam Rupiah. |
| `stock` | integer | Jumlah stok tersedia. |
| `category` | string | Nama kategori produk. |
| `order_process` | string | Tipe pemrosesan item: `auto`, `manual`, `h2h`, atau `smm`. |
| `h2h_provider` | string\|null | Nama source pemrosesan H2H jika item diproses via host-to-host. |
| `provider_meta` | object\|null | Metadata capability tambahan item H2H. |
| `required_fields` | array\|null | Daftar field input yang harus dikirim saat membuat transaksi. |
| `validation` | object | Metadata cek ID. |

#### Example Request

```bash
# Full sync (pertama kali):
curl --request GET \
  --url 'https://sekalipay.com/api/v1/item?per_page=all' \
  --header 'X-APIKEY: YOUR_API_KEY'

# Delta sync (selanjutnya):
curl --request GET \
  --url 'https://sekalipay.com/api/v1/item?per_page=all&updated_since=2026-02-26T14:00:00Z' \
  --header 'X-APIKEY: YOUR_API_KEY'
```

### Item Detail

**GET** `/v1/item/{id}`

Dapatkan informasi lengkap tentang satu item berdasarkan ID.

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | integer | ID item yang ingin dilihat. |

#### Example Request

```bash
curl --request GET \
  --url https://sekalipay.com/api/v1/item/123 \
  --header 'X-APIKEY: YOUR_API_KEY'
```

### Account Validation

**POST** `/v1/item/validate`

Gunakan endpoint ini untuk cek nickname atau nama akun sebelum membuat transaksi. Client cukup mengirim `item_id`; sistem akan memilih kode validasi provider dari produk.

#### Request Body

| Field | Type | Description |
|-------|------|-------------|
| `item_id` | integer | ID variant dari endpoint `/v1/item`. |
| `customer_id` | string | User ID, nomor e-wallet, nomor rekening, atau ID pelanggan. |
| `zone_id` | string\|null | Wajib hanya jika `validation.requires_zone_id` bernilai true. |

#### Example Request

```bash
curl --request POST \
  --url https://sekalipay.com/api/v1/item/validate \
  --header 'X-APIKEY: YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{"item_id":123,"customer_id":"256632355","zone_id":"9402"}'
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `data.display_name` | string | Nama siap tampil. |
| `data.account_name` | string | Nickname atau nama pemilik akun. |
| `data.region` | string\|null | Region akun untuk layanan yang mendukung region lookup. |
| `data.cached` | boolean | Bernilai true jika hasil diambil dari cache validasi. |

#### List Validation Services

**GET** `/v1/validation/services`

Mengembalikan daftar produk dan item yang memiliki validasi aktif.

| Query Param | Type | Description |
|-------------|------|-------------|
| `search` | string\|null | Opsional. Filter berdasarkan nama produk atau nama item. |

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `data[].product_id` | integer | ID produk yang punya validasi aktif. |
| `data[].product_name` | string | Nama produk. |
| `data[].validation` | object | Metadata validasi. |
| `data[].variants[]` | array | Daftar item. |
| `meta` | object | `total_products` dan `total_items`. |

### Stock Lock

**POST** `/v1/item/lock`

Reservasi stok sementara selama periode pembayaran untuk mencegah overselling. Lock stok sebelum buyer bayar agar tidak diambil oleh pembeli lain.

#### Alur Penggunaan

1. Buyer pilih produk
2. Lock stok (10 menit)
3. Buyer bayar
4. Buat transaksi + lock_token

> **Penting:**
> - Lock berlaku maksimal **10 menit**. Setelah expired, stok otomatis kembali tersedia.
> - Maksimal **10 lock aktif** secara bersamaan per akun reseller.
> - Lock **tidak diperlukan** untuk produk dengan stok unlimited (manual/h2h).
> - Saat membuat transaksi dengan `lock_token`, stok dijamin tersedia.

#### Request Body

| Parameter | Type | Description |
|-----------|------|-------------|
| `item_id` | integer | Required. ID item/variant yang akan di-lock. |
| `quantity` | integer | Required. Jumlah stok yang akan di-lock. |
| `lock_duration` | integer | Optional. Durasi lock dalam detik. Min: 60, Max: 600. Default: 600. |

#### Error Responses

| Code | Description |
|------|-------------|
| `404 ITEM_NOT_FOUND` | Item tidak ditemukan atau tidak aktif. |
| `422 INSUFFICIENT_STOCK` | Stok tidak mencukupi untuk di-lock. |
| `422 MINIMUM_ORDER_NOT_MET` | Quantity kurang dari minimum order item. |
| `422 LOCK_NOT_REQUIRED` | Item memiliki stok unlimited, tidak perlu di-lock. |
| `429 MAX_ACTIVE_LOCKS_REACHED` | Sudah mencapai batas maksimal 10 lock aktif. |

#### List Active Locks

**GET** `/v1/item/lock`

Lihat semua lock aktif milik Anda beserta sisa waktu.

#### Release Lock

**DELETE** `/v1/item/lock/{lock_token}`

Batalkan lock secara manual. Stok akan langsung tersedia kembali.

| Code | Description |
|------|-------------|
| `404 LOCK_NOT_FOUND` | Lock token tidak ditemukan atau bukan milik Anda. |
| `422 LOCK_ALREADY_USED / EXPIRED / RELEASED` | Lock sudah tidak aktif. |

#### Create Transaction with Lock

**POST** `/v1/trx` + `lock_token`

Saat membuat transaksi, tambahkan parameter `lock_token` untuk menjamin stok yang sudah di-lock.

| Parameter | Type | Description |
|-----------|------|-------------|
| `lock_token` | string | Optional. Token dari `POST /v1/item/lock`. |

#### Lock-specific Errors

| Code | Description |
|------|-------------|
| `404 LOCK_NOT_FOUND` | Lock token tidak ditemukan. |
| `422 LOCK_EXPIRED` | Lock sudah expired, stok tidak lagi di-reservasi. |
| `422 LOCK_MISMATCH` | item_id / quantity di carts tidak sesuai dengan lock. |

#### Example: Lock Stock

```bash
curl --request POST \
  --url https://sekalipay.com/api/v1/item/lock \
  --header 'X-APIKEY: YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "item_id": 123,
    "quantity": 1,
    "lock_duration": 600
  }'
```

#### Lock Response

```json
{
  "success": true,
  "data": {
    "lock_token": "LCK-a1b2c3d4-...",
    "item_id": 123,
    "quantity": 1,
    "locked_at": "2026-02-27T20:00:00Z",
    "expires_at": "2026-02-27T20:10:00Z"
  }
}
```

---

## Transactions Endpoints

### List Transactions

**GET** `/v1/trx`

Mendapatkan daftar transaksi.

### Create Transaction

**POST** `/v1/trx`

Buat transaksi baru untuk membeli item menggunakan saldo. Transaksi akan langsung diproses dan saldo akan dipotong secara otomatis.

#### Request Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ref_id` | string | Required. ID referensi unik dari sistem Anda. Max 191 karakter. |
| `carts` | array | Required. Array berisi item yang akan dibeli. |
| `carts.*.item_id` | integer | Required. ID item/variant yang akan dibeli. |
| `carts.*.quantity` | integer | Required. Jumlah item yang akan dibeli. |
| `carts.*.note` | string\|json | Conditional. Catatan untuk item. Format tergantung tipe produk. |
| `lock_token` | string | Optional. Token dari `POST /v1/item/lock`. |

#### Format Note untuk Item Open Denom

Jika item memiliki `provider_meta.open_denom = true`, kirim `carts.*.note` sebagai JSON string:

| Field | Type | Description |
|-------|------|-------------|
| `target` | string | Required. Tujuan transaksi. |
| `provider_qty` | integer | Required. Nominal yang dikirim ke provider. |
| `zone_id` | string | Optional. Server/zone ID. |

#### Format Note untuk Produk SMM

Untuk produk SMM, field `note` harus berupa JSON string:

| Field | Type | Description |
|-------|------|-------------|
| `target` | string | Required. Target SMM order. |
| `opt_smm` | array | Conditional. Array string opsi tambahan. |
| `comment_smm` | string | Optional. Komentar untuk layanan yang membutuhkan komentar. |

#### Error Responses

| Code | Description |
|------|-------------|
| `400 BALANCE_IS_INSUFFICIENT` | Saldo tidak mencukupi untuk transaksi ini. |
| `400 SMM_ORDER_REQUIRES_JSON_NOTE` | Produk SMM membutuhkan note dalam format JSON. |
| `422 REF_ID_ALREADY_EXIST` | ref_id sudah pernah digunakan. |
| `422 REQUIRED_FIELD_MISSING` | Field wajib produk tidak dikirim. |
| `503 PRODUCT_TEMPORARILY_UNAVAILABLE` | Produk sedang tidak tersedia. |

#### Example Request — Produk Biasa / H2H

```bash
curl --request POST \
  --url https://sekalipay.com/api/v1/trx \
  --header 'X-APIKEY: YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "ref_id": "TRX-2024-001",
    "carts": [
      {
        "item_id": 123,
        "quantity": 1,
        "note": "12345678"
      }
    ]
  }'
```

#### Example Request — Item Open Denom

```bash
curl --request POST \
  --url https://sekalipay.com/api/v1/trx \
  --header 'X-APIKEY: YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "ref_id": "OKC-OPEN-001",
    "carts": [
      {
        "item_id": 2451,
        "quantity": 1,
        "note": "{\"target\":\"081234567890\",\"provider_qty\":10000}"
      }
    ]
  }'
```

#### Example Request — Produk SMM

```bash
curl --request POST \
  --url https://sekalipay.com/api/v1/trx \
  --header 'X-APIKEY: YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "ref_id": "SMM-2024-001",
    "carts": [
      {
        "item_id": 1725,
        "quantity": 100,
        "note": "{\"target\":\"https://instagram.com/p/xxx\",\"opt_smm\":[\"@username\"],\"comment_smm\":\"\"}"
      }
    ]
  }'
```

#### Response Sample

```json
{
  "message": "OK",
  "data": {
    "invoice": "SPY1773219883T2S2",
    "ref_id": "TRX-2024-001",
    "status": "paid",
    "price": 270,
    "fees": 0,
    "amount": 270,
    "contact": "user@email.com",
    "created_at": "2024-01-01T12:00:00+07:00"
  }
}
```

### Transaction Detail

**GET** `/v1/trx/{ref_id}`

Dapatkan detail lengkap transaksi berdasarkan ref_id atau invoice. Response akan menyertakan data item, H2H results, dan SMM results sesuai jenis order.

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ref_id` | string | Reference ID atau Invoice transaksi. |

#### Response Fields

**Transaction Data**

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | ID unik transaksi |
| `ref_id` | string | Reference ID yang Anda kirim saat create order |
| `invoice` | string | Invoice number dari sistem |
| `payment_method` | string | Metode pembayaran: `saldo`, `qris`, dll |
| `status` | string | Status transaksi: `pending`, `paid`, `completed`, `failed` |
| `price` | integer | Harga produk (sebelum fee) |
| `fees` | integer\|null | Biaya transaksi (payment gateway fee) |
| `amount` | integer | Total yang dibayar (price + fees) |
| `note` | string\|null | Catatan transaksi dari sistem |
| `payment_link` | string\|null | Link pembayaran (hanya untuk payment gateway) |
| `qr_link` | string\|null | Link QR Code (untuk QRIS) |
| `expired_at` | datetime\|null | Waktu kadaluarsa pembayaran |
| `created_at` | datetime | Waktu transaksi dibuat |

**Items Array**

| Field | Type | Description |
|-------|------|-------------|
| `variant_id` | integer | ID variant produk |
| `variant_name` | string | Nama variant |
| `product_name` | string | Nama produk |
| `product_license` | string\|null | Data produk (akun/lisensi) - hanya untuk `auto` |
| `seller_note` | string\|null | Catatan dari seller |
| `description` | string\|null | Deskripsi produk |
| `price` | integer | Harga per item |
| `qty` | integer | Jumlah item |
| `note` | string\|null | Customer data (nomor HP, link target, dll) |
| `order_process` | string | Jenis proses: `auto`, `manual`, `h2h`, `smm` |

**H2H Results** (untuk order_process: h2h)

| Field | Type | Description |
|-------|------|-------------|
| `variant_id` | integer | ID variant yang diproses H2H |
| `sn` | string | Serial Number dari provider |
| `dispatch_status` | string | `completed` atau `failed` |
| `log_message` | string\|null | Pesan dari provider |

**SMM Results** (untuk order_process: smm)

| Field | Type | Description |
|-------|------|-------------|
| `variant_id` | integer | ID variant SMM |
| `order_id` | string\|null | ID order dari SMM Panel |
| `status` | string | `Pending`, `In progress`, `Completed`, `Partial` |
| `start_count` | integer\|null | Jumlah awal sebelum diproses |
| `remains` | integer\|null | Sisa yang belum terkirim (0 = selesai) |
| `provider_status` | string\|null | Status mentah dari source SMM |
| `delivered_count` | integer\|null | Jumlah yang sudah berhasil diproses |
| `refund_amount` | integer\|null | Nominal refund parsial jika ada |
| `partial_refund_pending_manual` | boolean | Penanda jika refund parsial masih menunggu tindak lanjut manual |

#### Example Request

```bash
curl --request GET \
  --url https://sekalipay.com/api/v1/trx/TRX-001 \
  --header 'X-APIKEY: YOUR_API_KEY'
```

#### Response Samples

**Auto Product Response**

```json
{
  "message": "OK",
  "data": {
    "id": 99899,
    "ref_id": "TRX-20260210-001",
    "invoice": "SPY1770673917X5",
    "payment_method": "saldo",
    "status": "completed",
    "price": 50000,
    "fees": null,
    "amount": 50000,
    "items": [{
      "variant_id": 8,
      "variant_name": "1 Tahun",
      "product_name": "Spotify",
      "product_license": "user@mail.com|pass",
      "price": 50000,
      "order_process": "auto"
    }]
  },
  "h2h_results": [],
  "smm_results": []
}
```

**H2H Response**

```json
{
  "message": "OK",
  "data": {
    "id": 99900,
    "ref_id": "TRX-002",
    "status": "completed",
    "items": [{
      "variant_id": 101,
      "variant_name": "Telkomsel 10K",
      "note": "08123456789",
      "order_process": "h2h"
    }]
  },
  "h2h_results": [{
    "variant_id": 101,
    "sn": "SN123456789",
    "dispatch_status": "completed",
    "log_message": "Transaksi Sukses"
  }],
  "smm_results": []
}
```

**SMM Response**

```json
{
  "message": "OK",
  "data": {
    "id": 99901,
    "ref_id": "TRX-003",
    "status": "completed",
    "items": [{
      "variant_id": 201,
      "variant_name": "1K Followers",
      "note": "https://instagram.com/user",
      "order_process": "h2h",
      "is_smm": true,
      "status": "processing"
    }]
  },
  "h2h_results": [],
  "smm_results": [{
    "variant_id": 201,
    "order_id": "98765",
    "status": "processing",
    "start_count": 5000,
    "remains": 350,
    "delivered_count": 650
  }]
}
```

### Bayar Tagihan (Pascabayar)

**POST** `/v1/trx/tagihan`

Endpoint khusus untuk pembayaran tagihan pascabayar (postpaid). **New**

---

## Leaderboard Endpoints

### Top 10 Reseller

**GET** `/v1/leaderboard`

Mendapatkan top 10 reseller.

### My Ranking

**GET** `/v1/leaderboard/profile`

Mendapatkan ranking user saat ini.

---

## Testing Endpoints

### Sandbox Order

**POST** `/v1/order/sandbox`

🧪 Endpoint untuk testing/sandbox order.

---

## Webhook

### Webhook Configuration

Terima notifikasi real-time ketika ada perubahan status order. Webhook akan mengirimkan HTTP POST ke endpoint Anda secara otomatis.

#### Quick Setup

1. **Generate Secret Key** - Buat secret key untuk signature verification dengan endpoint `POST /api/v1/webhook/secret`
2. **Set Callback URL** - Tentukan endpoint yang akan menerima webhook dengan endpoint `PUT /api/v1/webhook`
3. **Test Webhook** - Verifikasi konfigurasi dengan mengirim test callback menggunakan `POST /api/v1/webhook/test`

#### Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/v1/webhook` | Lihat konfigurasi webhook |
| `PUT` | `/v1/webhook` | Update konfigurasi (URL, enabled) |
| `POST` | `/v1/webhook/secret` | Generate secret key baru |
| `POST` | `/v1/webhook/test` | Kirim test callback |
| `GET` | `/v1/webhook/docs` | Dokumentasi webhook (JSON) |

#### Update Configuration

**PUT** `/v1/webhook`

| Parameter | Type | Description |
|-----------|------|-------------|
| `callback_url` | string | URL endpoint Anda (harus HTTPS) |
| `webhook_enabled` | boolean | true untuk mengaktifkan webhook |

> **Penting:** Callback URL harus menggunakan HTTPS untuk keamanan. HTTP hanya diizinkan untuk localhost/development.

#### Secret Key

Secret key digunakan untuk membuat signature agar Anda dapat memverifikasi bahwa callback benar-benar dari kami.

> ⚠️ **Secret key hanya ditampilkan sekali!** Simpan dengan aman. Jika hilang, Anda harus generate secret key baru.

#### Retry Policy

Jika endpoint Anda tidak merespons dengan HTTP 2xx, kami akan melakukan retry dengan exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 detik |
| 3 | 2 detik |
| 4 | 4 detik |
| 5 | 8 detik |

#### Example: Generate Secret

```bash
curl -X POST \
  'https://sekalipay.com/api/v1/webhook/secret' \
  -H 'X-APIKEY: your_api_key'
```

#### Example: Set Callback URL

```bash
curl -X PUT \
  'https://sekalipay.com/api/v1/webhook' \
  -H 'X-APIKEY: your_api_key' \
  -H 'Content-Type: application/json' \
  -d '{
    "callback_url": "https://your.site/webhook",
    "webhook_enabled": true
  }'
```

#### Example: Test Webhook

```bash
curl -X POST \
  'https://sekalipay.com/api/v1/webhook/test' \
  -H 'X-APIKEY: your_api_key'
```

### Webhook Events & Payload

Webhook akan mengirimkan notifikasi untuk berbagai event order. Setiap callback berisi payload JSON dengan informasi lengkap.

#### Event Types

| Event | Description |
|-------|-------------|
| `order.paid` | Dikirim ketika pembayaran order berhasil. Order sedang diproses. |
| `order.completed` | Dikirim ketika order selesai diproses. Produk sudah dikirim/diaktifkan. |
| `order.canceled` | Dikirim ketika order dibatalkan. Saldo akan dikembalikan jika sudah dibayar. |
| `order.item.sent` | Dikirim ketika admin mengirim item pesanan untuk **produk manual**. Event ini dikirim **per-item**. |
| `webhook.test` | Dikirim saat Anda menjalankan test webhook untuk verifikasi konfigurasi. |

#### HTTP Headers

| Header | Deskripsi |
|--------|-----------|
| `Content-Type` | application/json |
| `X-Signature` | SHA256 signature untuk verifikasi |
| `X-Timestamp` | Waktu pengiriman (ISO8601) |
| `X-Event` | Tipe event (order.paid, dll) |
| `User-Agent` | SekalipayWebhook/1.0 |

#### Payload Structure

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Tipe event |
| `timestamp` | string | Waktu event (ISO8601) |
| `data.invoice` | string | Nomor invoice |
| `data.ref_id` | string | Reference ID Anda |
| `data.status` | string | Status order |
| `data.price` | integer | Harga produk |
| `data.fees` | integer | Biaya admin |
| `data.amount` | integer | Total bayar |
| `data.items` | array | Daftar item order |

#### Payload Example (order.completed)

```json
{
  "event": "order.completed",
  "timestamp": "2024-01-15T10:30:00+07:00",
  "data": {
    "invoice": "INV-20240115-XXXXX",
    "ref_id": "your-ref-123",
    "status": "completed",
    "price": 50000,
    "fees": 1000,
    "amount": 51000,
    "payment_code": "saldo",
    "items": [
      {
        "variant_id": 123,
        "variant_name": "Diamond 100",
        "product_id": 45,
        "product_name": "Mobile Legends",
        "order_process": "h2h",
        "quantity": 1,
        "price": 50000,
        "subtotal": 50000,
        "note": "123456789|1234",
        "h2h_results": {
          "sn": "SN123456789",
          "dispatch_status": "Success",
          "dispatch_message": "Transaksi sukses",
          "ref_id": "TRX123456789"
        },
        "target": "123456789|1234",
        "status": "completed"
      }
    ]
  }
}
```

#### Expected Response

Endpoint Anda harus merespons dengan HTTP 2xx (200, 201, 202, 204) agar dianggap sukses.

> **Tips:** Langsung response OK terlebih dahulu, lalu proses data secara async. Ini mencegah timeout jika proses Anda memakan waktu lama.

```json
{
  "status": "ok"
}
```

### Webhook Signature Verification

Selalu verifikasi signature untuk memastikan callback benar-benar dari kami dan data tidak dimanipulasi.

#### Mengapa Harus Verifikasi?

| Tanpa Verifikasi | Dengan Verifikasi |
|------------------|-------------------|
| Siapa saja bisa mengirim request palsu ke endpoint Anda dan memanipulasi data order. | Hanya callback yang memiliki signature valid (dari kami) yang akan diproses. |

#### Cara Kerja Signature

Signature dibuat menggunakan algoritma **SHA256** dengan format:

```
signature = SHA256(ref_id + ":" + invoice + ":" + status + ":" + webhook_secret)
```

Nilai `status` untuk signature bersifat event-dependent:
- `payload.data.status` untuk `order.paid/order.completed/order.canceled`
- `item.sent` untuk `order.item.sent`
- `test` untuk `webhook.test`

#### Komponen Signature

| Komponen | Sumber |
|----------|--------|
| `ref_id` | Dari `payload.data.ref_id` |
| `invoice` | Dari `payload.data.invoice` |
| `status` | Event-dependent (lihat catatan di atas) |
| `webhook_secret` | Secret key Anda (dari generate secret) |

#### Langkah Verifikasi

1. **Terima Callback** - Parse JSON payload dari request body
2. **Ambil Signature dari Header** - Baca header `X-Signature`
3. **Buat Expected Signature** - Hitung signature menggunakan data dari payload + secret key Anda
4. **Bandingkan dengan Timing-Safe** - Gunakan `hash_equals()` untuk mencegah timing attack
5. **Proses atau Tolak** - Jika signature valid, proses data. Jika tidak, return 401.

#### Security Tips

- **Gunakan hash_equals()** - Jangan gunakan `==` atau `===` untuk membandingkan signature.
- **Jaga Secret Key** - Jangan pernah expose secret key di frontend, log, atau repository publik.
- **HTTPS Only** - Selalu gunakan HTTPS untuk callback URL.
- **Idempotency** - Cek apakah order sudah pernah diproses sebelum melakukan update.

#### PHP Implementation

```php
<?php

// 1. Terima payload
$payload = json_decode(
    file_get_contents('php://input'),
    true
);

// 2. Ambil signature dari header
$receivedSignature = 
    $_SERVER['HTTP_X_SIGNATURE'] ?? '';

// 3. Buat expected signature
$webhookSecret = env('WEBHOOK_SECRET');
$event = $payload['event'] ?? '';

// status untuk signature tergantung event
$statusForSignature = match ($event) {
    'order.item.sent' => 'item.sent',
    'webhook.test' => 'test',
    default => $payload['data']['status'] ?? '',
};

$expectedSignature = hash('sha256', 
    sprintf(
        '%s:%s:%s:%s',
        $payload['data']['ref_id'] ?? '',
        $payload['data']['invoice'] ?? '',
        $statusForSignature,
        $webhookSecret
    )
);

// 4. Verifikasi (timing-safe)
if (!hash_equals(
    $expectedSignature, 
    $receivedSignature
)) {
    http_response_code(401);
    echo json_encode([
        'error' => 'Invalid signature'
    ]);
    exit;
}

// 5. Signature valid! Proses data
$data = $payload['data'];

switch ($event) {
    case 'order.completed':
        // Update status order
        // Kirim notifikasi customer
        break;
    
    case 'order.canceled':
        // Handle canceled
        break;

    case 'order.item.sent':
        // Handle delivery item manual secara real-time
        break;
}

http_response_code(200);
echo json_encode(['status' => 'ok']);
```

#### Node.js Implementation

```javascript
const crypto = require('crypto');

app.post('/webhook', (req, res) => {
    const payload = req.body;
    const receivedSig = 
        req.headers['x-signature'];
    
    const webhookSecret = 
        process.env.WEBHOOK_SECRET;
    const event = payload.event || '';
    
    // status untuk signature tergantung event
    const statusForSignature =
        event === 'order.item.sent' ? 'item.sent'
        : event === 'webhook.test' ? 'test'
        : (payload.data?.status || '');
    
    // Buat expected signature
    const sigPayload = [
        payload.data.ref_id || '',
        payload.data.invoice || '',
        statusForSignature,
        webhookSecret
    ].join(':');
    
    const expectedSig = crypto
        .createHash('sha256')
        .update(sigPayload)
        .digest('hex');
    
    // Verifikasi (timing-safe)
    try {
        if (!crypto.timingSafeEqual(
            Buffer.from(expectedSig),
            Buffer.from(receivedSig)
        )) {
            return res
                .status(401)
                .json({ error: 'Invalid' });
        }
    } catch {
        return res
            .status(401)
            .json({ error: 'Invalid' });
    }
    
    // Valid! Proses
    const { event, data } = payload;
    console.log(`Received: ${event}`);
    
    res.json({ status: 'ok' });
});
```

---

## Error Codes

### Authentication Errors (401)

| Code | Description |
|------|-------------|
| `INVALID_API_KEY` | API Key tidak valid atau tidak ditemukan. |
| `ACCOUNT_MUST_BE_RESELLER` | Akun harus memiliki role reseller. |
| `INVALID_IP` | IP address tidak terdaftar di whitelist. |

### Forbidden Errors (403)

| Code | Description |
|------|-------------|
| `THE_ACCOUNT_HAS_BEEN_SUSPENDED` | Akun telah di-suspend. |

### Validation Errors (400/422)

| Code | Description |
|------|-------------|
| `BALANCE_IS_INSUFFICIENT` | Saldo tidak mencukupi untuk transaksi. |
| `REF_ID_ALREADY_EXIST` | ref_id sudah pernah digunakan. |
| `ITEM_NOT_FOUND` | Item tidak ditemukan. |
| `OUT_OF_STOCK` | Stok item habis. |
| `REQUIRED_FIELD_MISSING` | Field wajib produk tidak dikirim. |
| `SMM_ORDER_REQUIRES_JSON_NOTE` | Produk SMM membutuhkan note dalam format JSON. |

### Service Availability (503)

| Code | HTTP | Description |
|------|------|-------------|
| `PRODUCT_TEMPORARILY_UNAVAILABLE` | 503 | Produk sedang tidak tersedia. Order ditolak & saldo tidak terpotong. |

### Not Found Errors (404)

| Code | Description |
|------|-------------|
| `TRANSACTION_NOT_FOUND` | Transaksi tidak ditemukan. |
| `ITEM_NOT_FOUND` | Item tidak ditemukan. |

### Error Response Format

```json
{
  "message": "ERROR_CODE",
  "errors": {
    "field_name": [
      "Error description"
    ]
  }
}
```

> **Tip:** Selalu cek field `message` untuk menentukan jenis error dan handle sesuai kebutuhan aplikasi Anda.

---

## Support

Jika Anda memerlukan bantuan, silakan hubungi tim support kami melalui:
- [Kontak Kami](https://sekalipay.com/contact-us)

---

*Dokumentasi ini diperbarui secara berkala. Pastikan Anda selalu merujuk pada versi terbaru.*