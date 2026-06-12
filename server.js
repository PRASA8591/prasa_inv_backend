require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const salesRoutes = require('./routes/sales');
const userRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const customerRoutes = require('./routes/customers');
const supplyChainRoutes = require('./routes/supplychain');
const invoiceRoutes = require('./routes/invoices');
const shiftRoutes = require('./routes/shifts');
const warehouseRoutes = require('./routes/warehouses');
const stockTransferRoutes = require('./routes/transfers');


const app = express();

// Express HTTP Security Hardening Middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

// CORS origin configuration: support local development, FRONTEND_URL, and Vercel previews
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://localhost:3000'
];

if (process.env.FRONTEND_URL) {
    const envOrigins = process.env.FRONTEND_URL.split(',').map(url => url.trim());
    allowedOrigins.push(...envOrigins);
}

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, or postman)
        if (!origin) return callback(null, true);
        
        const isAllowed = allowedOrigins.includes(origin) || 
                          origin.endsWith('.vercel.app');
                          
        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`[CORS Warning] Blocked request from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(express.json());

const bcrypt = require('bcryptjs');
const User = require('./models/User');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    console.log('Connected to MongoDB');

    // Verify and ensure database indexes for performance speedup
    try {
        const db = mongoose.connection.db;
        const safeIndex = async (collection, spec, options) => {
            try {
                await db.collection(collection).createIndex(spec, options);
            } catch (err) {
                // Ignore index conflicts if index already exists (conflict code 85 or 86)
                if (err.code !== 85 && err.code !== 86 && !err.message.includes('already exists')) {
                    console.error(`[Performance Warning] Index creation failed on ${collection}:`, err.message);
                }
            }
        };
        
        // Item collection indices
        await safeIndex('items', { barcode: 1 });
        await safeIndex('items', { name: 1 });
        await safeIndex('items', { status: 1 });
        await safeIndex('items', { category: 1 });
        await safeIndex('items', { createdAt: -1 });

        // Sales collection indices
        await safeIndex('sales', { createdAt: -1 });
        await safeIndex('sales', { soldBy: 1 });

        // Customers collection indices
        await safeIndex('customers', { phone: 1 });
        await safeIndex('customers', { createdAt: -1 });

        // AuditLogs collection indices
        await safeIndex('auditlogs', { timestamp: -1 });
        await safeIndex('auditlogs', { userId: 1 });

        // Invoices collection indices
        await safeIndex('invoices', { invoiceNumber: 1 });
        await safeIndex('invoices', { createdAt: -1 });

        // Purchase Orders collection indices
        await safeIndex('purchaseorders', { poNumber: 1 });
        await safeIndex('purchaseorders', { createdAt: -1 });

        // Goods Received Notes collection indices
        await safeIndex('grns', { grnNumber: 1 });
        await safeIndex('grns', { createdAt: -1 });

        // Location-scoped indices for speed optimization
        await safeIndex('items', { 'batches.warehouseId': 1 });
        await safeIndex('sales', { warehouseId: 1 });
        await safeIndex('invoices', { warehouseId: 1 });
        await safeIndex('shifts', { warehouseId: 1 });
        await safeIndex('purchaseorders', { warehouseId: 1 });
        await safeIndex('grns', { warehouseId: 1 });
        await safeIndex('supplierreturns', { warehouseId: 1 });

        console.log('[Performance] Database indexes verified and ensured.');
    } catch (indexErr) {
        console.error('[Performance Warning] Index verification failed:', indexErr.message);
    }
    // Seed default warehouse if none exists
    const Warehouse = require('./models/Warehouse');
    const warehouseCount = await Warehouse.countDocuments();
    if (warehouseCount === 0) {
        await Warehouse.create({
            name: 'Main Warehouse',
            code: 'WH-MAIN',
            address: 'Default HQ Location',
            status: 'active'
        });
        console.log('Initial default warehouse created: Main Warehouse (WH-MAIN)');
    }
    // Seed initial user
    const userCount = await User.countDocuments();
    if (userCount === 0) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('admin123', salt);
        await User.create({
            username: 'admin',
            password: hashedPassword,
            role: 'admin',
            access: {
                dashboard: true,
                items: true,
                items_edit: true,
                stock: true,
                stock_edit: true,
                pos: true,
                price: true,
                crm: true,
                crm_edit: true,
                supply: true,
                supply_edit: true,
                invoices: true,
                invoices_edit: true,
                users: true,
                users_edit: true,
                reports: true,
                settings: true,
                approvals: true,
                recent_bills: true
            }
        });
        console.log('Initial admin user created: admin / admin123');
    } else {
        // Run database migration helper to convert any string access keys to boolean equivalents and ensure all split keys exist
        const allUsers = await User.find().lean();
        const splitKeys = [
            'dashboard', 'items', 'stock', 'direct_stock', 'pos', 'price', 
            'crm', 'supply', 'invoices', 'users', 'reports', 'locations', 
            'settings', 'approvals', 'recent_bills', 'audit_logs'
        ];

        for (let u of allUsers) {
            let changed = false;
            const access = u.access || {};

            // Map old settings key to locations if locations is not set yet
            if (access.locations === undefined && access.settings !== undefined) {
                access.locations = access.settings;
                access.locations_edit = access.settings_edit || access.settings;
                changed = true;
            }

            for (const key of splitKeys) {
                const editKey = `${key}_edit`;
                
                // Initialize base key if missing
                if (access[key] === undefined || access[key] === null) {
                    if (u.role === 'admin') {
                        access[key] = true;
                    } else {
                        const isRestricted = ['users', 'settings', 'locations', 'approvals', 'recent_bills', 'audit_logs'].includes(key);
                        access[key] = !isRestricted;
                    }
                    changed = true;
                }

                // Initialize edit key if missing
                if (access[editKey] === undefined || access[editKey] === null) {
                    if (u.role === 'admin') {
                        access[editKey] = true;
                    } else {
                        const isRestricted = ['users', 'settings', 'locations', 'approvals', 'recent_bills', 'audit_logs'].includes(key);
                        access[editKey] = !isRestricted && access[key] === true;
                    }
                    changed = true;
                }
            }

            if (changed) {
                await User.updateOne({ _id: u._id }, { $set: { access } });
                console.log(`Migrated advanced permissions for user: ${u.username}`);
            }
        }
    }
}).catch(err => {
    console.error('Error connecting to MongoDB:', err.message);
});

const auditRoutes = require('./routes/audit');

app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/supply', supplyChainRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/transfers', stockTransferRoutes);


app.get('/api/ping', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
            return res.status(503).json({ status: 'db_disconnected' });
        }
        await mongoose.connection.db.admin().ping();
        res.json({ status: 'online' });
    } catch (err) {
        res.status(503).json({ status: 'db_disconnected', message: err.message });
    }
});

const SystemSetting = require('./models/SystemSetting');
const Item = require('./models/Item');

let lastRunDateString = '';

const runDailyStockUpdate = async () => {
    try {
        const settings = await SystemSetting.findOne();
        if (!settings || !settings.dailyStockUpdateEnabled) {
            return;
        }

        const targetQty = settings.dailyStockUpdateQty !== undefined ? settings.dailyStockUpdateQty : 100;
        console.log(`[Scheduler] Automatic Daily Stock Update triggered. Setting all items stock qty to ${targetQty}...`);

        const items = await Item.find();
        if (items.length > 0) {
            const bulkOps = items.map(item => {
                const updateDoc = {
                    quantity: targetQty
                };
                if (item.batches && item.batches.length > 0) {
                    const updatedBatches = [...item.batches];
                    updatedBatches[0].quantity = targetQty;
                    for (let i = 1; i < updatedBatches.length; i++) {
                        updatedBatches[i].quantity = 0;
                    }
                    updateDoc.batches = updatedBatches;
                }
                return {
                    updateOne: {
                        filter: { _id: item._id },
                        update: { $set: updateDoc }
                    }
                };
            });
            await Item.bulkWrite(bulkOps);
        }
        console.log(`[Scheduler] Successfully updated ${items.length} items to ${targetQty} qty.`);
    } catch (err) {
        console.error('[Scheduler Error] Daily stock update failed:', err);
    }
};

setInterval(async () => {
    try {
        const settings = await SystemSetting.findOne();
        if (!settings || !settings.dailyStockUpdateEnabled) {
            return;
        }

        const now = new Date();
        const currentHour = String(now.getHours()).padStart(2, '0');
        const currentMin = String(now.getMinutes()).padStart(2, '0');
        const currentTimeStr = `${currentHour}:${currentMin}`;

        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const date = String(now.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${date}`;

        if (currentTimeStr === settings.dailyStockUpdateTime && lastRunDateString !== todayStr) {
            lastRunDateString = todayStr;
            await runDailyStockUpdate();
        }
    } catch (err) {
        console.error('[Scheduler Interval Error]', err);
    }
}, 60 * 1000);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
