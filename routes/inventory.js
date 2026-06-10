const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const auth = require('../middleware/auth');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const checkPermission = require('../middleware/permission');

const checkInventoryRead = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(401).json({ message: 'Invalid session.' });
        if (user.role === 'admin') return next();
        const hasItems = user.access && (user.access.items === true || user.access.items === 'view' || user.access.items === 'full');
        const hasStock = user.access && (user.access.stock === true || user.access.stock === 'view' || user.access.stock === 'full');
        if (hasItems || hasStock) {
            return next();
        }
        return res.status(403).json({ message: 'Access denied. Lacks items or stock view permission.' });
    } catch (err) {
        res.status(500).send('Handshake error.');
    }
};

// @route   GET api/inventory
// @desc    Get all items
// @access  Private
router.get('/', [auth, checkInventoryRead], async (req, res) => {
    try {
        let warehouseId = req.query.warehouseId || req.user.currentWarehouse;
        if (req.user.role !== 'admin') {
            warehouseId = req.user.currentWarehouse;
        }
        let items = await Item.find().sort({ createdAt: -1 }).lean();

        if (warehouseId) {
            const Warehouse = require('../models/Warehouse');
            const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' }).lean();
            const isDefaultSelected = defaultWH && String(defaultWH._id) === String(warehouseId);

            items = items.map(itemObj => {
                const filteredBatches = (itemObj.batches || []).filter(b => {
                    if (String(b.warehouseId) === String(warehouseId)) return true;
                    if (isDefaultSelected && !b.warehouseId) return true;
                    return false;
                });
                itemObj.batches = filteredBatches;
                itemObj.quantity = filteredBatches.reduce((sum, b) => sum + (b.quantity || 0), 0);
                return itemObj;
            });
        }

        res.json(items);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/inventory/:id
// @desc    Get item by ID
// @access  Private
router.get('/:id', [auth, checkInventoryRead], async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);
        if (!item) return res.status(404).json({ message: 'Item not found' });
        res.json(item);
    } catch (err) {
        console.error(err.message);
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ message: 'Item not found' });
        }
        res.status(500).send('Server Error');
    }
});

// @route   POST api/inventory
// @desc    Create a new item
// @access  Private
router.post('/', [auth, checkPermission('items', 'full')], async (req, res) => {
    const { name, sku, barcode, description, quantity, price, sellingPrice, costPrice, status, category, subCategory, unitType, taxBracket, supplier, reorderPoint } = req.body;

    const baseSellingPrice = sellingPrice !== undefined ? sellingPrice : (price !== undefined ? price : 0);

    try {
        const newItem = new Item({
            name,
            sku,
            barcode,
            description,
            quantity: quantity || 0,
            price: baseSellingPrice,
            sellingPrice: baseSellingPrice,
            costPrice: costPrice || 0,
            status: status || 'active',
            category,
            subCategory: subCategory || '',
            unitType: unitType || 'pieces',
            taxBracket: taxBracket || 0,
            supplier,
            reorderPoint: reorderPoint || 5,
            createdBy: req.user.id
        });

        const item = await newItem.save();

        // Write AuditLog
        const userRecord = await User.findById(req.user.id);
        const operatorName = userRecord ? userRecord.username : 'Billing System';
        await AuditLog.create({
            userId: req.user.id,
            username: operatorName,
            action: 'ITEM_CREATED',
            module: 'INVENTORY',
            details: `Created new item "${item.name}" (SKU: ${item.sku}) with price: Rs.${item.price} and cost: Rs.${item.costPrice}`,
            warehouseId: req.user.currentWarehouse
        });

        res.json(item);
    } catch (err) {
        console.error(err.message);
        if (err.code === 11000) {
            return res.status(400).json({ message: 'Item with this SKU already exists' });
        }
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/inventory/:id
// @desc    Update an item
// @access  Private
router.put('/:id', auth, async (req, res) => {
    const { name, sku, barcode, description, quantity, price, sellingPrice, costPrice, status, movingAverageCost, category, subCategory, unitType, taxBracket, supplier, reorderPoint, batches } = req.body;

    const itemFields = {};
    if (name) itemFields.name = name;
    if (sku) itemFields.sku = sku;
    if (barcode !== undefined) itemFields.barcode = barcode;
    if (description !== undefined) itemFields.description = description;
    if (quantity !== undefined) itemFields.quantity = quantity;
    if (costPrice !== undefined) itemFields.costPrice = costPrice;
    if (status !== undefined) itemFields.status = status;
    
    if (sellingPrice !== undefined) {
        itemFields.sellingPrice = sellingPrice;
        itemFields.price = sellingPrice;
    } else if (price !== undefined) {
        itemFields.sellingPrice = price;
        itemFields.price = price;
    }

    if (movingAverageCost !== undefined) itemFields.movingAverageCost = movingAverageCost;
    if (category) itemFields.category = category;
    if (subCategory !== undefined) itemFields.subCategory = subCategory;
    if (unitType) itemFields.unitType = unitType;
    if (taxBracket !== undefined) itemFields.taxBracket = taxBracket;
    if (supplier !== undefined) itemFields.supplier = supplier;
    if (reorderPoint !== undefined) itemFields.reorderPoint = reorderPoint;
    // We will merge and assign batches and quantity after loading the item from the DB

    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(401).json({ message: 'Invalid session.' });
        if (user.role !== 'admin') {
            const isStockAdjustment = batches !== undefined || quantity !== undefined || req.body.auditAction === 'DIRECT_STOCK_ADD';
            if (isStockAdjustment) {
                if (!user.access || (user.access.stock_edit !== true && user.access.stock !== 'full')) {
                    return res.status(403).json({ message: 'Access denied. Requires full stock adjustment permission.' });
                }
            } else {
                if (!user.access || (user.access.items_edit !== true && user.access.items !== 'full')) {
                    return res.status(403).json({ message: 'Access denied. Requires full items catalog permission.' });
                }
            }
        }

        let item = await Item.findById(req.params.id);

        if (!item) return res.status(404).json({ message: 'Item not found' });

        if (batches !== undefined) {
            const Warehouse = require('../models/Warehouse');
            const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
            const defaultWHId = defaultWH ? String(defaultWH._id) : null;
            const activeWHId = req.user.currentWarehouse ? String(req.user.currentWarehouse) : null;

            // Preserve batches belonging to other warehouses
            const otherWarehousesBatches = item.batches.filter(b => {
                const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                if (activeWHId && bWhId === activeWHId) {
                    return false;
                }
                return true;
            });

            // Standardize/ensure active warehouse ID on the updated/added batches
            const newActiveBatches = batches.map(b => {
                if (!b.warehouseId && activeWHId) {
                    b.warehouseId = activeWHId;
                }
                return b;
            });

            const mergedBatches = [...otherWarehousesBatches, ...newActiveBatches];
            itemFields.batches = mergedBatches;
            itemFields.quantity = mergedBatches.reduce((sum, b) => sum + (parseFloat(b.quantity) || 0), 0);
        }

        const oldPrice = item.price;
        const oldCostPrice = item.movingAverageCost || item.costPrice || 0;
        const oldQty = item.quantity;

        item = await Item.findByIdAndUpdate(
            req.params.id,
            { $set: itemFields },
            { new: true }
        );

        // Fetch user context for audit trail
        const userRecord = await User.findById(req.user.id);
        const operatorName = userRecord ? userRecord.username : 'Billing System';

        // Audit check for price change
        const newPrice = item.price;
        const newCostPrice = item.movingAverageCost || item.costPrice || 0;
        if (oldPrice !== newPrice || oldCostPrice !== newCostPrice) {
            await AuditLog.create({
                userId: req.user.id,
                username: operatorName,
                action: 'PRICE_CHANGE',
                module: 'INVENTORY',
                details: `Price modified for item "${item.name}" (SKU: ${item.sku}). Selling Price: Rs.${oldPrice} -> Rs.${newPrice}, Cost Price: Rs.${oldCostPrice} -> Rs.${newCostPrice}.`,
                warehouseId: req.user.currentWarehouse
            });
        }

        // Audit check for direct manual stock adjustment
        const newQty = item.quantity;
        if (oldQty !== newQty) {
            const logAction = req.body.auditAction || 'STOCK_ADJUSTMENT';
            const logDetails = req.body.auditDetails || `Stock quantity adjusted for item "${item.name}" (SKU: ${item.sku}). Quantity: ${oldQty} -> ${newQty}.`;
            await AuditLog.create({
                userId: req.user.id,
                username: operatorName,
                action: logAction,
                module: 'INVENTORY',
                details: logDetails,
                warehouseId: req.user.currentWarehouse
            });
        }

        const isStockAdjustment = req.body.batches !== undefined || req.body.quantity !== undefined || req.body.auditAction === 'DIRECT_STOCK_ADD';
        if (!isStockAdjustment) {
            await AuditLog.create({
                userId: req.user.id,
                username: operatorName,
                action: 'ITEM_UPDATED',
                module: 'INVENTORY',
                details: `Updated details for item "${item.name}" (SKU: ${item.sku}).`,
                warehouseId: req.user.currentWarehouse
            });
        }

        res.json(item);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE api/inventory/:id
// @desc    Delete an item
// @access  Private
router.delete('/:id', [auth, checkPermission('items', 'full')], async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);

        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }

        await Item.findByIdAndDelete(req.params.id);

        // Write AuditLog
        const userRecord = await User.findById(req.user.id);
        const operatorName = userRecord ? userRecord.username : 'Billing System';
        await AuditLog.create({
            userId: req.user.id,
            username: operatorName,
            action: 'ITEM_DELETED',
            module: 'INVENTORY',
            details: `Deleted item "${item.name}" (SKU: ${item.sku}) from catalog`,
            warehouseId: req.user.currentWarehouse
        });

        res.json({ message: 'Item removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/inventory/transfer
// @desc    Transfer stock between warehouses
// @access  Private
router.post('/transfer', [auth, checkPermission('stock', 'full')], async (req, res) => {
    const { itemId, batchNumber, fromWarehouseId, toWarehouseId, quantity } = req.body;

    if (!itemId || !batchNumber || !fromWarehouseId || !toWarehouseId || quantity <= 0) {
        return res.status(400).json({ message: 'Missing required transfer details.' });
    }

    try {
        const item = await Item.findById(itemId);
        if (!item) return res.status(404).json({ message: 'Item not found.' });

        const Warehouse = require('../models/Warehouse');
        const fromWH = await Warehouse.findById(fromWarehouseId);
        const toWH = await Warehouse.findById(toWarehouseId);
        if (!fromWH || !toWH) return res.status(404).json({ message: 'Source or destination warehouse not found.' });

        const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
        const isFromDefault = defaultWH && String(defaultWH._id) === String(fromWarehouseId);
        const isToDefault = defaultWH && String(defaultWH._id) === String(toWarehouseId);

        const sourceBatch = item.batches.find(b => {
            if (b.batchNumber !== batchNumber) return false;
            if (String(b.warehouseId) === String(fromWarehouseId)) return true;
            if (isFromDefault && !b.warehouseId) return true;
            return false;
        });

        if (!sourceBatch) {
            return res.status(404).json({ message: `Batch ${batchNumber} not found in source warehouse ${fromWH.name}.` });
        }

        if (sourceBatch.quantity < quantity) {
            return res.status(400).json({ message: `Insufficient quantity in source batch. Available: ${sourceBatch.quantity}` });
        }

        // Deduct quantity from source batch
        sourceBatch.quantity -= quantity;

        // Add to target batch
        let targetBatch = item.batches.find(b => {
            if (b.batchNumber !== batchNumber) return false;
            if (String(b.warehouseId) === String(toWarehouseId)) return true;
            if (isToDefault && !b.warehouseId) return true;
            return false;
        });

        if (targetBatch) {
            targetBatch.quantity += quantity;
        } else {
            item.batches.push({
                batchNumber: sourceBatch.batchNumber,
                expiryDate: sourceBatch.expiryDate,
                costPrice: sourceBatch.costPrice,
                sellingPrice: sourceBatch.sellingPrice,
                quantity: quantity,
                status: sourceBatch.status,
                warehouseId: toWarehouseId
            });
        }

        // Update overall item quantity
        item.quantity = item.batches.reduce((sum, b) => sum + (b.quantity || 0), 0);
        await item.save();

        // Log audit
        const userRecord = await User.findById(req.user.id);
        const operator = userRecord ? userRecord.username : 'System';

        await AuditLog.create({
            userId: req.user.id,
            username: operator,
            action: 'STOCK_TRANSFER',
            module: 'INVENTORY',
            details: `Transferred ${quantity} units of "${item.name}" (SKU: ${item.sku}) batch "${batchNumber}" from "${fromWH.name}" to "${toWH.name}".`,
            warehouseId: req.user.currentWarehouse
        });

        res.json({ message: 'Stock transferred successfully.', item });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
