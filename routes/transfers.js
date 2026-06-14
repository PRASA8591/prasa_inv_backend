const express = require('express');
const router = express.Router();
const StockTransfer = require('../models/StockTransfer');
const Item = require('../models/Item');
const Warehouse = require('../models/Warehouse');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const { checkLicenseActive } = require('../middleware/licenseGuard');

router.use(checkLicenseActive);

// Helper to generate sequential transfer number safely
async function generateTransferNo() {
    let attempts = 0;
    while (attempts < 10) {
        const count = await StockTransfer.countDocuments();
        const transferNo = `TR-${String(count + 1 + attempts).padStart(4, '0')}`;
        const existing = await StockTransfer.findOne({ transferNo });
        if (!existing) {
            return transferNo;
        }
        attempts++;
    }
    return `TR-${Date.now()}`;
}

// @route   GET api/transfers
// @desc    Get all stock transfers
// @access  Private
router.get('/', [auth, checkPermission('transfers', 'view')], async (req, res) => {
    try {
        const transfers = await StockTransfer.find()
            .populate('sourceWarehouse', 'name code')
            .populate('destinationWarehouse', 'name code')
            .populate('initiatedBy', 'username')
            .populate('approvedBy', 'username')
            .populate('receivedBy', 'username')
            .populate('cancelledBy', 'username')
            .sort({ createdAt: -1 });
        res.json(transfers);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/transfers/:id
// @desc    Get stock transfer by ID
// @access  Private
router.get('/:id', [auth, checkPermission('transfers', 'view')], async (req, res) => {
    try {
        const transfer = await StockTransfer.findById(req.params.id)
            .populate('sourceWarehouse', 'name code address phone email manager')
            .populate('destinationWarehouse', 'name code address phone email manager')
            .populate('initiatedBy', 'username')
            .populate('approvedBy', 'username')
            .populate('receivedBy', 'username')
            .populate('cancelledBy', 'username');
        if (!transfer) {
            return res.status(404).json({ message: 'Transfer record not found.' });
        }
        res.json(transfer);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/transfers
// @desc    Create a new transfer request (Pending)
// @access  Private
router.post('/', [auth, checkPermission('transfers', 'full')], async (req, res) => {
    const { sourceWarehouseId, destinationWarehouseId, items, remarks } = req.body;

    if (!sourceWarehouseId || !destinationWarehouseId) {
        return res.status(400).json({ message: 'Please provide source and destination warehouses.' });
    }

    if (String(sourceWarehouseId) === String(destinationWarehouseId)) {
        return res.status(400).json({ message: 'Source and destination warehouses must be different.' });
    }

    try {
        const sourceWH = await Warehouse.findById(sourceWarehouseId);
        const destWH = await Warehouse.findById(destinationWarehouseId);
        if (!sourceWH || !destWH) {
            return res.status(404).json({ message: 'Source or destination warehouse not found.' });
        }

        const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
        const defaultWHId = defaultWH ? String(defaultWH._id) : null;

        const processedItems = [];

        // Validate stock levels at source warehouse if items are provided
        if (items && Array.isArray(items) && items.length > 0) {
            for (const reqItem of items) {
                const { itemId, batchNumber, quantity } = reqItem;
                if (!itemId || !batchNumber || quantity <= 0) {
                    return res.status(400).json({ message: 'Invalid item request details.' });
                }

                const item = await Item.findById(itemId);
                if (!item) {
                    return res.status(404).json({ message: `Item with ID ${itemId} not found.` });
                }

                // Find batch in source warehouse
                const batch = item.batches.find(b => {
                    const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                    const searchWhId = String(sourceWarehouseId) === defaultWHId ? null : String(sourceWarehouseId);
                    
                    // Match batch number
                    if (b.batchNumber !== batchNumber) return false;
                    
                    // Match warehouse
                    if (searchWhId) {
                        return bWhId === searchWhId;
                    } else {
                        return !b.warehouseId || bWhId === defaultWHId;
                    }
                });

                if (!batch) {
                    return res.status(404).json({ message: `Batch "${batchNumber}" for item "${item.name}" not found in source warehouse "${sourceWH.name}".` });
                }

                if (batch.quantity < quantity) {
                    return res.status(400).json({ message: `Insufficient stock in batch "${batchNumber}" of item "${item.name}". Available: ${batch.quantity}, Requested: ${quantity}` });
                }

                processedItems.push({
                    itemId: item._id,
                    name: item.name,
                    sku: item.sku,
                    batchNumber: batch.batchNumber,
                    quantity: quantity,
                    costPrice: batch.costPrice,
                    sellingPrice: batch.sellingPrice
                });
            }
        }

        const transferNo = await generateTransferNo();

        const transfer = new StockTransfer({
            transferNo,
            sourceWarehouse: sourceWarehouseId,
            destinationWarehouse: destinationWarehouseId,
            items: processedItems,
            remarks: remarks || '',
            initiatedBy: req.user.id,
            status: 'Draft'
        });

        await transfer.save();

        // Write AuditLog
        const userRecord = await User.findById(req.user.id);
        const operator = userRecord ? userRecord.username : 'System';
        await AuditLog.create({
            userId: req.user.id,
            username: operator,
            action: 'STOCK_TRANSFER_DRAFT_CREATED',
            module: 'INVENTORY',
            details: `Created stock transfer draft ${transferNo} from "${sourceWH.name}" to "${destWH.name}".`,
            warehouseId: req.user.currentWarehouse
        });

        res.status(201).json(transfer);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/transfers/:id
// @desc    Update a stock transfer draft (items, remarks, destination)
// @access  Private
router.put('/:id', [auth, checkPermission('transfers', 'full')], async (req, res) => {
    const { destinationWarehouseId, items, remarks } = req.body;

    try {
        const transfer = await StockTransfer.findById(req.params.id);
        if (!transfer) {
            return res.status(404).json({ message: 'Transfer record not found.' });
        }

        if (transfer.status !== 'Draft') {
            return res.status(400).json({ message: 'Can only modify stock transfers in "Draft" status.' });
        }

        if (destinationWarehouseId) {
            if (String(transfer.sourceWarehouse) === String(destinationWarehouseId)) {
                return res.status(400).json({ message: 'Source and destination warehouses must be different.' });
            }
            const destWH = await Warehouse.findById(destinationWarehouseId);
            if (!destWH) {
                return res.status(404).json({ message: 'Destination warehouse not found.' });
            }
            transfer.destinationWarehouse = destinationWarehouseId;
        }

        if (remarks !== undefined) {
            transfer.remarks = remarks;
        }

        if (items && Array.isArray(items)) {
            const sourceWarehouseId = transfer.sourceWarehouse;
            const sourceWH = await Warehouse.findById(sourceWarehouseId);
            const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
            const defaultWHId = defaultWH ? String(defaultWH._id) : null;

            const processedItems = [];

            for (const reqItem of items) {
                const { itemId, batchNumber, quantity } = reqItem;
                if (!itemId || !batchNumber || quantity <= 0) {
                    return res.status(400).json({ message: 'Invalid item request details.' });
                }

                const item = await Item.findById(itemId);
                if (!item) {
                    return res.status(404).json({ message: `Item with ID ${itemId} not found.` });
                }

                // Find batch in source warehouse
                const batch = item.batches.find(b => {
                    const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                    const searchWhId = String(sourceWarehouseId) === defaultWHId ? null : String(sourceWarehouseId);
                    
                    if (b.batchNumber !== batchNumber) return false;
                    if (searchWhId) {
                        return bWhId === searchWhId;
                    } else {
                        return !b.warehouseId || bWhId === defaultWHId;
                    }
                });

                if (!batch) {
                    return res.status(404).json({ message: `Batch "${batchNumber}" for item "${item.name}" not found in source warehouse "${sourceWH.name}".` });
                }

                if (batch.quantity < quantity) {
                    return res.status(400).json({ message: `Insufficient stock in batch "${batchNumber}" of item "${item.name}". Available: ${batch.quantity}, Requested: ${quantity}` });
                }

                processedItems.push({
                    itemId: item._id,
                    name: item.name,
                    sku: item.sku,
                    batchNumber: batch.batchNumber,
                    quantity: quantity,
                    costPrice: batch.costPrice,
                    sellingPrice: batch.sellingPrice
                });
            }
            transfer.items = processedItems;
        }

        await transfer.save();

        // Write AuditLog
        const userRecord = await User.findById(req.user.id);
        const operator = userRecord ? userRecord.username : 'System';
        await AuditLog.create({
            userId: req.user.id,
            username: operator,
            action: 'STOCK_TRANSFER_DRAFT_UPDATED',
            module: 'INVENTORY',
            details: `Updated stock transfer draft ${transfer.transferNo}.`,
            warehouseId: req.user.currentWarehouse
        });

        res.json(transfer);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/transfers/:id/approve
// @desc    Approve transfer & change status to 'In Transit' (Deduct stock from source)
// @access  Private (Admins or approvals role)
router.post('/:id/approve', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'admin' && (!user.access || (!user.access.approvals && !user.access.transfers_edit && !user.access.transfers))) {
            return res.status(403).json({ message: 'Access denied. Requires approvals or transfers permission.' });
        }

        const transfer = await StockTransfer.findById(req.params.id);
        if (!transfer) {
            return res.status(404).json({ message: 'Transfer record not found.' });
        }

        if (transfer.status !== 'Pending' && transfer.status !== 'Draft') {
            return res.status(400).json({ message: `Cannot approve transfer in "${transfer.status}" status.` });
        }

        if (!transfer.items || transfer.items.length === 0) {
            return res.status(400).json({ message: 'Cannot dispatch/approve a transfer with no items.' });
        }

        const sourceWH = await Warehouse.findById(transfer.sourceWarehouse);
        const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
        const defaultWHId = defaultWH ? String(defaultWH._id) : null;

        // Verify and deduct stock
        for (const reqItem of transfer.items) {
            const item = await Item.findById(reqItem.itemId);
            if (!item) {
                return res.status(404).json({ message: `Item "${reqItem.name}" no longer exists in system.` });
            }

            const batch = item.batches.find(b => {
                const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                const searchWhId = String(transfer.sourceWarehouse) === defaultWHId ? null : String(transfer.sourceWarehouse);
                
                if (b.batchNumber !== reqItem.batchNumber) return false;
                if (searchWhId) {
                    return bWhId === searchWhId;
                } else {
                    return !b.warehouseId || bWhId === defaultWHId;
                }
            });

            if (!batch || batch.quantity < reqItem.quantity) {
                return res.status(400).json({ 
                    message: `Cannot approve. Stock level changed for item "${item.name}" batch "${reqItem.batchNumber}". Available: ${batch ? batch.quantity : 0}` 
                });
            }

            // Deduct quantity
            batch.quantity -= reqItem.quantity;

            // Recalculate parent item total quantity
            item.quantity = item.batches.reduce((sum, b) => sum + (b.quantity || 0), 0);
            await item.save();
        }

        transfer.status = 'In Transit';
        transfer.approvedBy = req.user.id;
        transfer.approvedDate = Date.now();
        await transfer.save();

        // Write AuditLog
        const operator = user ? user.username : 'System';
        await AuditLog.create({
            userId: req.user.id,
            username: operator,
            action: 'STOCK_TRANSFER_SHIPPED',
            module: 'INVENTORY',
            details: `Approved & Shipped stock transfer ${transfer.transferNo} from "${sourceWH.name}". Items are now In Transit.`,
            warehouseId: req.user.currentWarehouse
        });

        res.json(transfer);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/transfers/:id/receive
// @desc    Receive transfer & change status to 'Completed' (Add stock to destination)
// @access  Private
router.post('/:id/receive', auth, async (req, res) => {
    try {
        const transfer = await StockTransfer.findById(req.params.id);
        if (!transfer) {
            return res.status(404).json({ message: 'Transfer record not found.' });
        }

        if (transfer.status !== 'In Transit') {
            return res.status(400).json({ message: `Cannot receive transfer in "${transfer.status}" status.` });
        }

        const destWH = await Warehouse.findById(transfer.destinationWarehouse);
        const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
        const defaultWHId = defaultWH ? String(defaultWH._id) : null;
        const targetWhId = String(transfer.destinationWarehouse) === defaultWHId ? null : transfer.destinationWarehouse;

        // Add stock to destination batches
        for (const reqItem of transfer.items) {
            const item = await Item.findById(reqItem.itemId);
            if (!item) {
                return res.status(404).json({ message: `Item "${reqItem.name}" no longer exists in system.` });
            }

            // Look for existing batch in target warehouse
            let targetBatch = item.batches.find(b => {
                const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                const searchWhId = String(transfer.destinationWarehouse) === defaultWHId ? null : String(transfer.destinationWarehouse);
                
                if (b.batchNumber !== reqItem.batchNumber) return false;
                if (searchWhId) {
                    return bWhId === searchWhId;
                } else {
                    return !b.warehouseId || bWhId === defaultWHId;
                }
            });

            if (targetBatch) {
                targetBatch.quantity += reqItem.quantity;
            } else {
                // Find expiry date from another warehouse batch if possible, otherwise null
                const sampleBatch = item.batches.find(b => b.batchNumber === reqItem.batchNumber);
                const expiryDate = sampleBatch ? sampleBatch.expiryDate : null;

                item.batches.push({
                    batchNumber: reqItem.batchNumber,
                    expiryDate,
                    costPrice: reqItem.costPrice,
                    sellingPrice: reqItem.sellingPrice,
                    quantity: reqItem.quantity,
                    status: 'active',
                    warehouseId: targetWhId
                });
            }

            // Recalculate parent item total quantity
            item.quantity = item.batches.reduce((sum, b) => sum + (b.quantity || 0), 0);
            await item.save();
        }

        transfer.status = 'Completed';
        transfer.receivedBy = req.user.id;
        transfer.receivedDate = Date.now();
        await transfer.save();

        // Write AuditLog
        const userRecord = await User.findById(req.user.id);
        const operator = userRecord ? userRecord.username : 'System';
        await AuditLog.create({
            userId: req.user.id,
            username: operator,
            action: 'STOCK_TRANSFER_RECEIVED',
            module: 'INVENTORY',
            details: `Received stock transfer ${transfer.transferNo} at "${destWH.name}". Inventory has been updated.`,
            warehouseId: req.user.currentWarehouse
        });

        res.json(transfer);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/transfers/:id/cancel
// @desc    Cancel transfer (Return stock if In Transit)
// @access  Private (Admins or approvals role)
router.post('/:id/cancel', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.role !== 'admin' && (!user.access || (!user.access.approvals && !user.access.transfers_edit && !user.access.transfers))) {
            return res.status(403).json({ message: 'Access denied. Requires approvals or transfers permission.' });
        }

        const transfer = await StockTransfer.findById(req.params.id);
        if (!transfer) {
            return res.status(404).json({ message: 'Transfer record not found.' });
        }

        if (transfer.status === 'Completed' || transfer.status === 'Cancelled') {
            return res.status(400).json({ message: `Cannot cancel a transfer that is already "${transfer.status}".` });
        }

        const sourceWH = await Warehouse.findById(transfer.sourceWarehouse);
        const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
        const defaultWHId = defaultWH ? String(defaultWH._id) : null;
        const sourceWhId = String(transfer.sourceWarehouse) === defaultWHId ? null : transfer.sourceWarehouse;

        // If transfer was 'In Transit', stock was already deducted. We must return it to source!
        if (transfer.status === 'In Transit') {
            for (const reqItem of transfer.items) {
                const item = await Item.findById(reqItem.itemId);
                if (!item) {
                    continue; // Skip if item deleted (unexpected)
                }

                let sourceBatch = item.batches.find(b => {
                    const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                    const searchWhId = String(transfer.sourceWarehouse) === defaultWHId ? null : String(transfer.sourceWarehouse);
                    
                    if (b.batchNumber !== reqItem.batchNumber) return false;
                    if (searchWhId) {
                        return bWhId === searchWhId;
                    } else {
                        return !b.warehouseId || bWhId === defaultWHId;
                    }
                });

                if (sourceBatch) {
                    sourceBatch.quantity += reqItem.quantity;
                } else {
                    const sampleBatch = item.batches.find(b => b.batchNumber === reqItem.batchNumber);
                    const expiryDate = sampleBatch ? sampleBatch.expiryDate : null;

                    item.batches.push({
                        batchNumber: reqItem.batchNumber,
                        expiryDate,
                        costPrice: reqItem.costPrice,
                        sellingPrice: reqItem.sellingPrice,
                        quantity: reqItem.quantity,
                        status: 'active',
                        warehouseId: sourceWhId
                    });
                }

                // Recalculate parent item total quantity
                item.quantity = item.batches.reduce((sum, b) => sum + (b.quantity || 0), 0);
                await item.save();
            }
        }

        transfer.status = 'Cancelled';
        transfer.cancelledBy = req.user.id;
        transfer.cancelledDate = Date.now();
        await transfer.save();

        // Write AuditLog
        const operator = user ? user.username : 'System';
        await AuditLog.create({
            userId: req.user.id,
            username: operator,
            action: 'STOCK_TRANSFER_CANCELLED',
            module: 'INVENTORY',
            details: `Cancelled stock transfer request ${transfer.transferNo}. Stock has been returned to "${sourceWH.name}" if it had shipped.`,
            warehouseId: req.user.currentWarehouse
        });

        res.json(transfer);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
