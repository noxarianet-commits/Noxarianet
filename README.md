# NoxarianetApp 💳

A lightweight DANA-inspired mobile web application and payment receipt verification engine.

## 🚀 Features
- **Mobile E-Wallet UI**: Clean mobile-first web interface for managing balances, top-ups, and transactions.
- **Admin Dashboard**: Comprehensive admin control panel for user balances, announcements, and merchant configuration.
- **Payment Gateways**:
  - **SekaliPay Integration**: Reseller API for PPOB & digital goods.
  - **Orkut / OrderKuota**: Automated QRIS top-ups with real-time balance mutation checking.
  - **FinCloud Integration**: H2H PPOB & QRIS invoice payments.
- **Database Engine**: Powered by SQLite3 with JSON file fallback.

## 📦 Getting Started

### 1. Installation
```bash
npm install
```

### 2. Configuration
Copy `.env.example` to `.env` and fill in your API keys and configuration:
```env
PORT=3006
JWT_SECRET=your_jwt_secret
SEKALIPAY_API_KEY=your_sekalipay_api_key
SEKALIPAY_WEBHOOK_SECRET=your_sekalipay_webhook_secret
```

### 3. Run Server
```bash
# Production mode
npm start

# Development mode
npm run dev
```

---
*Created for NoxarianetApp.*
