const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const Item = require('../models/Item');
const Customer = require('../models/Customer');
const Shift = require('../models/Shift');
const auth = require('../middleware/auth');
const User = require('../models/User');
const checkPermission = require('../middleware/permission');
const SystemSetting = require('../models/SystemSetting');
const { checkLicenseActive } = require('../middleware/licenseGuard');

router.use(checkLicenseActive);

const checkSalesRead = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(401).json({ message: 'Invalid session.' });
        if (user.role === 'admin') return next();
        const hasPos = user.access && (user.access.pos === true || user.access.pos === 'view' || user.access.pos === 'full');
        const hasRecent = user.access && (user.access.recent_bills === true || user.access.recent_bills === 'view' || user.access.recent_bills === 'full');
        const hasDashboard = user.access && (user.access.dashboard === true || user.access.dashboard === 'view' || user.access.dashboard === 'full');
        if (hasPos || hasRecent || hasDashboard) {
            return next();
        }
        return res.status(403).json({ message: 'Access denied. Lacks pos, recent bills, or dashboard view permission.' });
    } catch (err) {
        res.status(500).send('Handshake error.');
    }
};

// @route   POST api/sales
// @desc    Create a new transaction (POS Checkout)
// @access  Private
router.post('/', [auth, checkPermission('pos', 'full')], async (req, res) => {
    const { items, paymentMethod, customerName, customerId } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ message: 'Cart is empty' });
    }

    try {
        let totalAmount = 0;
        const saleItems = [];

        // Check and deduct stock
        for (let cartItem of items) {
            const item = await Item.findById(cartItem._id);
            if (!item) {
                return res.status(404).json({ message: `Product ${cartItem.name} not found` });
            }

            // Determine specific batch if provided
            let specificBatch = null;
            if (cartItem.batchId) {
                specificBatch = item.batches.id(cartItem.batchId);
                if (!specificBatch) {
                    return res.status(404).json({ message: `Batch not found for product ${item.name}` });
                }
                if (specificBatch.quantity < cartItem.cartQuantity) {
                    return res.status(400).json({ message: `Insufficient batch stock for ${item.name}. In stock: ${specificBatch.quantity}` });
                }
            } else {
                const Warehouse = require('../models/Warehouse');
                const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
                const defaultWHId = defaultWH ? String(defaultWH._id) : null;
                const activeWHId = req.user.currentWarehouse ? String(req.user.currentWarehouse) : null;

                const currentWarehouseQty = item.batches.reduce((sum, b) => {
                    const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                    if (activeWHId && bWhId === activeWHId) {
                        return sum + (b.quantity || 0);
                    }
                    return sum;
                }, 0);

                if (currentWarehouseQty < cartItem.cartQuantity) {
                    return res.status(400).json({ message: `Insufficient stock for ${item.name} in this location. Available: ${currentWarehouseQty}` });
                }
            }

            // Use the cart price (which accounts for batch override) or fallback to item price
            const itemSellingPrice = cartItem.price || item.price;
            const subtotal = itemSellingPrice * cartItem.cartQuantity;
            totalAmount += subtotal;

            saleItems.push({
                itemId: item._id,
                name: item.name,
                quantity: cartItem.cartQuantity,
                price: itemSellingPrice,
                subtotal: subtotal,
                batchId: cartItem.batchId || null,
                batchNumber: cartItem.batchNumber || null
            });

            // Deduct quantity
            item.quantity -= cartItem.cartQuantity;
            if (specificBatch) {
                specificBatch.quantity -= cartItem.cartQuantity;
            } else if (item.batches && item.batches.length > 0) {
                let remaining = cartItem.cartQuantity;
                const Warehouse = require('../models/Warehouse');
                const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
                const defaultWHId = defaultWH ? String(defaultWH._id) : null;
                const activeWHId = req.user.currentWarehouse ? String(req.user.currentWarehouse) : null;

                for (let b of item.batches) {
                    const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                    if (activeWHId && bWhId !== activeWHId) {
                        continue;
                    }

                    if (b.quantity >= remaining) {
                        b.quantity -= remaining;
                        remaining = 0;
                        break;
                    } else {
                        remaining -= b.quantity;
                        b.quantity = 0;
                    }
                }
            }
            await item.save();
        }

        let salePayments = req.body.payments;
        if (!salePayments || salePayments.length === 0) {
            salePayments = [{ method: paymentMethod || 'cash', amount: totalAmount }];
        }

        const newSale = new Sale({
            items: saleItems,
            totalAmount,
            paymentMethod: paymentMethod || 'cash',
            payments: salePayments,
            customerName: customerName || 'Walk-in Customer',
            soldBy: req.user.id,
            warehouseId: req.user.currentWarehouse
        });

        const sale = await newSale.save();

        // ==========================================
        // CRM LOYALTY & TAB CONSOLIDATION
        // ==========================================
        if (customerId) {
            const customer = await Customer.findById(customerId);
            if (customer) {
                // Process each split payment part
                for (const p of salePayments) {
                    if (p.method === 'credit_note' || p.method === 'store_credit') {
                        customer.currentBalance += p.amount;
                        if (p.method === 'store_credit') {
                            customer.walletTransactions.push({
                                amount: p.amount,
                                type: 'payment',
                                details: `POS Sale #${sale._id.toString().slice(-6)}`
                            });
                        }
                    }
                }
                
                // Calculate tiered reward points
                const tier = customer.loyaltyTier || 'Bronze';
                let multiplier = 0.01;
                if (tier === 'Silver') multiplier = 0.015;
                if (tier === 'Gold') multiplier = 0.02;

                const pointsEarned = Math.floor(totalAmount * multiplier);
                customer.loyaltyPoints += pointsEarned;
                
                customer.purchaseHistory.push({
                    saleId: sale._id,
                    amount: totalAmount,
                    date: new Date()
                });

                // Tier checks based on lifetime spend
                const totalLifetimeSpend = customer.purchaseHistory.reduce((sum, h) => sum + h.amount, 0);
                if (totalLifetimeSpend >= 5000) {
                    customer.loyaltyTier = 'Gold';
                } else if (totalLifetimeSpend >= 1000) {
                    customer.loyaltyTier = 'Silver';
                } else {
                    customer.loyaltyTier = 'Bronze';
                }
                
                await customer.save();
            }
        }

        // ==========================================
        // ACTIVE DRAWER / SHIFT RECONCILIATION
        // ==========================================
        const activeShift = await Shift.findOne({ userId: req.user.id, status: 'open', warehouseId: req.user.currentWarehouse });
        if (activeShift) {
            activeShift.salesCount += 1;
            activeShift.salesTotal += totalAmount;
            
            // Increment physical drawer only by the CASH portion of split payments
            const cashAmount = salePayments
                .filter(p => p.method === 'cash')
                .reduce((sum, p) => sum + p.amount, 0);
            
            activeShift.expectedDrawerAmount += cashAmount;
            await activeShift.save();
        }

        res.json(sale);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   GET api/sales
// @desc    Get transaction history
// @access  Private
router.get('/', [auth, checkSalesRead], async (req, res) => {
    try {
        let warehouseId = req.query.warehouseId || req.user.currentWarehouse;
        if (req.user.role !== 'admin') {
            warehouseId = req.user.currentWarehouse;
        }
        const query = {};
        if (warehouseId) {
            query.warehouseId = warehouseId;
        }
        const sales = await Sale.find(query)
            .populate('soldBy', 'username')
            .sort({ createdAt: -1 })
            .lean();
        res.json(sales);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/sales/stats
// @desc    Get aggregated sales statistics
// @access  Private
router.get('/stats/summary', auth, async (req, res) => {
    try {
        const mongoose = require('mongoose');
        let warehouseId = req.query.warehouseId || req.user.currentWarehouse;
        if (req.user.role !== 'admin') {
            warehouseId = req.user.currentWarehouse;
        }

        const matchCriteria = {};
        if (warehouseId) {
            matchCriteria.warehouseId = new mongoose.Types.ObjectId(warehouseId);
        }

        // Calculate total sales amount and count efficiently using aggregation pipeline
        const summaryStats = await Sale.aggregate([
            { $match: matchCriteria },
            {
                $group: {
                    _id: null,
                    totalSales: { $sum: "$totalAmount" },
                    salesCount: { $sum: 1 }
                }
            }
        ]);
        
        const totalSales = summaryStats.length > 0 ? summaryStats[0].totalSales : 0;
        const salesCount = summaryStats.length > 0 ? summaryStats[0].salesCount : 0;

        // Group by day for last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const statsMatch = {
            createdAt: { $gte: sevenDaysAgo }
        };
        if (warehouseId) {
            statsMatch.warehouseId = new mongoose.Types.ObjectId(warehouseId);
        }

        const stats = await Sale.aggregate([
            { $match: statsMatch },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    total: { $sum: "$totalAmount" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.json({
            totalSales,
            salesCount,
            chartData: stats
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
