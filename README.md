# PrasaTek Inventory & Enterprise Management System

Welcome to the **PrasaTek Inventory & Enterprise Management System**, a premium inventory control suite developed by **PrasaTek System Solutions**.

This application consists of a modern React-based frontend SPA (Single Page Application) and a secure Node.js/Express backend API connected to MongoDB.

---

## Technical Architecture & Stack

### Frontend
- **Framework**: React 18, Vite
- **Styling**: Vanilla CSS, TailwindCSS (curated premium layout palettes, glassmorphism UI, clean dark accents)
- **Icons**: Lucide React
- **HTTP Client**: Axios

### Backend
- **Framework**: Node.js, Express (v5)
- **Database**: MongoDB Atlas, Mongoose ODM
- **Authentication**: JWT (JSON Web Tokens), bcryptjs
- **Environment Management**: dotenv

---

## Core System Features

1. **System Activation**:
   - Built-in activation panel allowing system administrators to activate/deactivate evaluation licenses (trials ranging from 1 to 14 days) and commercial subscriptions (ranging from 30 days to 5 years).
   - Real-time license evaluation checks and background expiry auto-lockout overlay for cashiers.
2. **POS Terminal**:
   - Thermal 80mm styled sales checkouts, cashier shift tracking, and integrated CRM customer loyalty points rewards.
3. **Goods Received Notes (GRN) & Purchase Orders (PO)**:
   - Structured multi-tier approvals workflow for inventory supply chain management.
4. **Interactive Stock Management**:
   - Stock level adjustments, batch tracking, expiration warnings, and automatic daily stock re-balancing scheduler.
5. **Security & Access Control**:
   - Granular RBAC (Role-Based Access Control) whitelists, HTTP security headers, login rate limiting, and administrator account protection rules.

---

## Setup & Running Locally

### Prerequisites
- Node.js (v18 or higher recommended)
- MongoDB Database Instance (local or Atlas cluster URI)

### Backend Configuration
1. Navigate to the `backend` folder:
   ```bash
   cd backend
   ```
2. Create a `.env` file and configure the environmental values (do NOT share your credentials in source control):
   ```env
   PORT=5000
   MONGODB_URI=mongodb://[username]:[password]@[host]:[port]/[database]
   JWT_SECRET=your_custom_jwt_secret_key
   ```
3. Install dependencies and start the backend server:
   ```bash
   npm install
   # For production:
   npm start
   # For development (with hot-reload):
   npm run dev
   ```

### Frontend Configuration
1. Navigate to the `frontend` folder:
   ```bash
   cd frontend
   ```
2. Install dependencies and start the Vite development server:
   ```bash
   npm install
   npm run dev
   ```
3. Open `http://localhost:5174` (or the port specified in terminal) in your web browser.

---

## Security & Verification

This system enforces strict checks:
- **Rate Limiting**: Login endpoints are throttled to 10 requests/minute.
- **Admin Account Protection**: Admin users cannot be deleted. Modifying admin credentials is restricted solely to admin users.
- For security policies and reporting vulnerabilities, please refer to the [SECURITY.md](SECURITY.md) file.

---

## Licensing

Licensed under proprietary terms for **PrasaTek System Solutions**. Refer to the [LICENSE](LICENSE) file for usage and copyright guidelines.
