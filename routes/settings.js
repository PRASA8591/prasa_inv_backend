const express = require('express');
const router = express.Router();
const SystemSetting = require('../models/SystemSetting');
const auth = require('../middleware/auth');
const Item = require('../models/Item');
const User = require('../models/User');
const { validateLicenseKey, generateLicenseKey } = require('../utils/licenseHelper');

const AuditLog = require('../models/AuditLog');
const Customer = require('../models/Customer');
const GRN = require('../models/GRN');
const Invoice = require('../models/Invoice');
const PurchaseOrder = require('../models/PurchaseOrder');
const Sale = require('../models/Sale');
const Shift = require('../models/Shift');
const SupplierReturn = require('../models/SupplierReturn');
const Warehouse = require('../models/Warehouse');


// Middleware to check if user is admin or has settings access
const settingsAccess = async (req, res, next) => {
    try {
        const currentUser = await User.findById(req.user.id);
        if (!currentUser) {
            return res.status(401).json({ message: 'Invalid operator session.' });
        }
        if (currentUser.role === 'admin' || (currentUser.access && (currentUser.access.settings === true || currentUser.access.settings === 'full'))) {
            return next();
        }
        return res.status(403).json({ message: 'Access denied. Requires settings write permission.' });
    } catch (err) {
        res.status(500).send('Handshake error.');
    }
};

// @route   GET api/settings/public
// @desc    Get public system settings (company name & logo)
// @access  Public
router.get('/public', async (req, res) => {
    try {
        let settings = await SystemSetting.findOne();
        if (!settings) {
            settings = new SystemSetting({});
            await settings.save();
        }
        res.json({
            companyName: settings.companyName,
            shopLogo: settings.shopLogo
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   GET api/settings
// @desc    Get current system settings
// @access  Private (all logged in users can read setting values for display)
router.get('/', auth, async (req, res) => {
    try {
        let settings = await SystemSetting.findOne();
        if (!settings) {
            // Initialize default settings if not existing
            settings = new SystemSetting({});
            await settings.save();
        }
        res.json(settings);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   PUT api/settings
// @desc    Update system settings
// @access  Private/Admin
router.put('/', [auth, settingsAccess], async (req, res) => {
    const { 
        companyName, currency, currencySymbol, taxRate, address, theme, 
        glassmorphism, animations, mobile, email, shopLogo,
        dailyStockUpdateEnabled, dailyStockUpdateQty, dailyStockUpdateTime,
        useBatchNumbers, useExpirationDates, useCostPrice
    } = req.body;

    try {
        let settings = await SystemSetting.findOne();
        if (!settings) {
            settings = new SystemSetting({});
        }

        if (companyName !== undefined) settings.companyName = companyName;
        if (currency !== undefined) settings.currency = currency;
        if (currencySymbol !== undefined) settings.currencySymbol = currencySymbol;
        if (taxRate !== undefined) settings.taxRate = parseFloat(taxRate);
        if (address !== undefined) settings.address = address;
        if (theme !== undefined) settings.theme = theme;
        if (glassmorphism !== undefined) settings.glassmorphism = glassmorphism;
        if (animations !== undefined) settings.animations = animations;
        if (mobile !== undefined) settings.mobile = mobile;
        if (email !== undefined) settings.email = email;
        if (shopLogo !== undefined) settings.shopLogo = shopLogo;
        
        if (dailyStockUpdateEnabled !== undefined) settings.dailyStockUpdateEnabled = dailyStockUpdateEnabled;
        if (dailyStockUpdateQty !== undefined) settings.dailyStockUpdateQty = parseInt(dailyStockUpdateQty) || 0;
        if (dailyStockUpdateTime !== undefined) settings.dailyStockUpdateTime = dailyStockUpdateTime;

        if (useBatchNumbers !== undefined) settings.useBatchNumbers = useBatchNumbers;
        if (useExpirationDates !== undefined) settings.useExpirationDates = useExpirationDates;
        if (useCostPrice !== undefined) settings.useCostPrice = useCostPrice;

        await settings.save();
        res.json(settings);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   POST api/settings/trigger-stock-update
// @desc    Trigger automatic daily stock update
// @access  Private
router.post('/trigger-stock-update', auth, async (req, res) => {
    try {
        const settings = await SystemSetting.findOne();
        if (!settings) {
            return res.status(404).json({ message: 'Settings not found' });
        }
        
        const targetQty = settings.dailyStockUpdateQty !== undefined ? settings.dailyStockUpdateQty : 100;
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
        res.json({ message: `Successfully updated ${items.length} items to ${targetQty} qty.` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// Helper to calculate expiration date
const calculateExpiry = (type, duration) => {
    const date = new Date();
    if (type === 'trial') {
        const days = parseInt(duration, 10);
        date.setDate(date.getDate() + days);
    } else if (type === 'subscription') {
        if (duration.includes('day')) {
            const days = parseInt(duration, 10);
            date.setDate(date.getDate() + days);
        } else if (duration.includes('month')) {
            const months = parseInt(duration, 10);
            date.setMonth(date.getMonth() + months);
        } else if (duration.includes('year')) {
            const years = parseInt(duration, 10);
            date.setFullYear(date.getFullYear() + years);
        }
    }
    return date;
};

// @route   POST api/settings/activation/activate
// @desc    Activate system trial or subscription using License Key
// @access  Private/Admin only
router.post('/activation/activate', auth, async (req, res) => {
    const { licenseKey } = req.body;
    try {
        const currentUser = await User.findById(req.user.id);
        if (!currentUser || currentUser.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied. Requires admin privileges.' });
        }

        if (!licenseKey) {
            return res.status(400).json({ message: 'License Key is required.' });
        }

        const validation = validateLicenseKey(licenseKey);
        if (!validation.valid) {
            return res.status(400).json({ message: validation.error });
        }

        let settings = await SystemSetting.findOne();
        if (!settings) {
            settings = new SystemSetting({});
        }

        // Apply license configuration details
        settings.activationStatus = 'active';
        settings.activationType = validation.type;
        settings.activationStartDate = new Date();
        settings.activationExpiryDate = validation.expiryDate;
        
        settings.licenseKey = licenseKey;
        settings.licenseTier = validation.tier;
        settings.licenseHolder = validation.holder;
        settings.maxUsers = validation.limits.maxUsers;
        settings.maxWarehouses = validation.limits.maxWarehouses;
        settings.maxItems = validation.limits.maxItems;

        // Push to activation history
        settings.activationHistory.push({
            licenseKey,
            type: validation.type,
            tier: validation.tier,
            duration: validation.duration,
            activatedAt: new Date(),
            expiresAt: validation.expiryDate
        });

        await settings.save();

        // Audit Log Entry
        await AuditLog.create({
            userId: req.user.id,
            username: currentUser.username,
            action: 'LICENSE_ACTIVATE',
            module: 'SETTINGS',
            details: `System activated successfully using key: ${licenseKey.substring(0, 7)}... Plan: ${validation.tier} (${validation.duration}).`,
            ipAddress: req.ip
        });

        res.json(settings);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   POST api/settings/activation/deactivate
// @desc    Deactivate system trial or subscription
// @access  Private/Admin only
router.post('/activation/deactivate', auth, async (req, res) => {
    try {
        const currentUser = await User.findById(req.user.id);
        if (!currentUser || currentUser.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied. Requires admin privileges.' });
        }

        let settings = await SystemSetting.findOne();
        if (!settings) {
            settings = new SystemSetting({});
        }

        // Reset settings properties
        settings.activationStatus = 'deactivated';
        settings.activationExpiryDate = new Date(); // Expire immediately
        settings.licenseKey = null;
        settings.licenseTier = 'Trial Mode';
        settings.licenseHolder = 'Evaluation User';
        settings.maxUsers = 5;
        settings.maxWarehouses = 2;
        settings.maxItems = 100;

        await settings.save();

        // Audit Log Entry
        await AuditLog.create({
            userId: req.user.id,
            username: currentUser.username,
            action: 'LICENSE_DEACTIVATE',
            module: 'SETTINGS',
            details: 'System license manually deactivated by administrator. Capacity limits reset to evaluation defaults.',
            ipAddress: req.ip
        });

        res.json(settings);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   POST api/settings/activation/generate-key
// @desc    Developer/Reseller license key generator
// @access  Private/Admin only
router.post('/activation/generate-key', auth, async (req, res) => {
    const { tierCode, durationCode, holderName } = req.body;
    try {
        const currentUser = await User.findById(req.user.id);
        if (!currentUser || currentUser.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied. Requires admin privileges.' });
        }

        if (!tierCode || !durationCode) {
            return res.status(400).json({ message: 'Missing tierCode or durationCode for key generation.' });
        }

        const licenseKey = generateLicenseKey(tierCode, durationCode, holderName || 'PrasaTek Client');
        res.json({ licenseKey });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// Middleware to restrict to admin only
const adminOnly = async (req, res, next) => {
    try {
        const currentUser = await User.findById(req.user.id);
        if (!currentUser) {
            return res.status(401).json({ message: 'Invalid operator session.' });
        }
        if (currentUser.role === 'admin') {
            return next();
        }
        return res.status(403).json({ message: 'Access denied. Requires admin privileges.' });
    } catch (err) {
        res.status(500).send('Handshake error.');
    }
};

// @route   GET api/settings/backup
// @desc    Download full database backup as JSON
// @access  Private/Admin only
router.get('/backup', [auth, adminOnly], async (req, res) => {
    try {
        const [
            auditlogs,
            customers,
            grns,
            invoices,
            items,
            purchaseorders,
            sales,
            shifts,
            supplierreturns,
            systemsettings,
            users,
            warehouses
        ] = await Promise.all([
            AuditLog.find({}),
            Customer.find({}),
            GRN.find({}),
            Invoice.find({}),
            Item.find({}),
            PurchaseOrder.find({}),
            Sale.find({}),
            Shift.find({}),
            SupplierReturn.find({}),
            SystemSetting.find({}),
            User.find({}),
            Warehouse.find({})
        ]);

        res.json({
            version: '1.0',
            timestamp: new Date().toISOString(),
            data: {
                AuditLog: auditlogs,
                Customer: customers,
                GRN: grns,
                Invoice: invoices,
                Item: items,
                PurchaseOrder: purchaseorders,
                Sale: sales,
                Shift: shifts,
                SupplierReturn: supplierreturns,
                SystemSetting: systemsettings,
                User: users,
                Warehouse: warehouses
            }
        });
    } catch (err) {
        console.error('Backup error:', err.message);
        res.status(500).json({ message: 'Failed to generate database backup.', error: err.message });
    }
});

// @route   POST api/settings/restore
// @desc    Restore database from uploaded JSON backup
// @access  Private/Admin only
router.post('/restore', [auth, adminOnly], async (req, res) => {
    const { backupData } = req.body;
    if (!backupData || !backupData.data) {
        return res.status(400).json({ message: 'Invalid backup data format. Missing data payload.' });
    }

    const { data } = backupData;

    // Verify User collection exists and has at least one admin to prevent lockout
    if (!data.User || !Array.isArray(data.User) || data.User.length === 0) {
        return res.status(400).json({ message: 'Restore aborted: Backup file does not contain a User list.' });
    }

    const hasAdmin = data.User.some(u => u.role === 'admin');
    if (!hasAdmin) {
        return res.status(400).json({ message: 'Restore aborted: Backup file must contain at least one administrator user to prevent system lockout.' });
    }

    // List of models and their keys in data
    const collectionsToRestore = [
        { model: AuditLog, key: 'AuditLog' },
        { model: Customer, key: 'Customer' },
        { model: GRN, key: 'GRN' },
        { model: Invoice, key: 'Invoice' },
        { model: Item, key: 'Item' },
        { model: PurchaseOrder, key: 'PurchaseOrder' },
        { model: Sale, key: 'Sale' },
        { model: Shift, key: 'Shift' },
        { model: SupplierReturn, key: 'SupplierReturn' },
        { model: SystemSetting, key: 'SystemSetting' },
        { model: User, key: 'User' },
        { model: Warehouse, key: 'Warehouse' }
    ];

    try {
        const counts = {};

        // Sequentially purge and populate to ensure integrity
        for (const item of collectionsToRestore) {
            const records = data[item.key] || [];
            await item.model.deleteMany({});
            
            if (records.length > 0) {
                // mongoose insertMany will preserve _id
                await item.model.insertMany(records);
            }
            counts[item.key] = records.length;
        }

        // Add a log entry for the restore event
        try {
            await AuditLog.create({
                userId: req.user.id,
                username: 'admin',
                action: 'RESTORE_DATABASE',
                module: 'SETTINGS',
                details: 'System database restored successfully from JSON backup file.',
                ipAddress: req.ip
            });
        } catch (logErr) {
            console.error('Audit logging failed during restore:', logErr);
        }

        res.json({
            message: 'Database restored successfully.',
            details: counts
        });
    } catch (err) {
        console.error('Restore error:', err.message);
        res.status(500).json({ message: 'Failed to restore database.', error: err.message });
    }
});

module.exports = router;

