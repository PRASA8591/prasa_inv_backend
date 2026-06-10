const express = require('express');
const router = express.Router();
const PurchaseOrder = require('../models/PurchaseOrder');
const GRN = require('../models/GRN');
const Item = require('../models/Item');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');

// ==========================================
// PURCHASE ORDERS (PO) ENDPOINTS
// ==========================================

// Get all Purchase Orders
router.get('/po', [auth, checkPermission('supply', 'view')], async (req, res) => {
    try {
        let warehouseId = req.query.warehouseId || req.user.currentWarehouse;
        if (req.user.role !== 'admin') {
            warehouseId = req.user.currentWarehouse;
        }
        const query = {};
        if (warehouseId) {
            query.warehouseId = warehouseId;
        }
        const pos = await PurchaseOrder.find(query)
            .populate('orderedBy', 'username')
            .populate('approvedBy', 'username')
            .sort({ createdAt: -1 });
        res.json(pos);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Create a Purchase Order (Initially saved as 'draft' or 'pending_approval')
router.post('/po', [auth, checkPermission('supply', 'full')], async (req, res) => {
    const { supplier, items, notes, expectedDeliveryDate, status } = req.body;
    try {
        const poCount = await PurchaseOrder.countDocuments();
        const poNumber = `PO-${new Date().getFullYear()}-${(poCount + 1).toString().padStart(4, '0')}`;

        let totalAmount = 0;
        const poItems = items.map(item => {
            totalAmount += (item.quantityOrdered * item.estimatedCost);
            return {
                itemId: item.itemId,
                name: item.name,
                sku: item.sku,
                quantityOrdered: item.quantityOrdered,
                estimatedCost: item.estimatedCost
            };
        });

        const newPO = new PurchaseOrder({
            poNumber,
            supplier,
            items: poItems,
            totalAmount,
            notes,
            status: status || 'draft',
            expectedDeliveryDate,
            orderedBy: req.user.id,
            warehouseId: req.user.currentWarehouse
        });

        await newPO.save();
        res.json(newPO);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Reopen and Update an existing PO (allowed only if status is draft or pending_approval)
router.put('/po/:id', [auth, checkPermission('supply', 'full')], async (req, res) => {
    const { supplier, items, notes, expectedDeliveryDate, status } = req.body;
    try {
        let po = await PurchaseOrder.findById(req.params.id);
        if (!po) return res.status(404).json({ message: 'Purchase Order not found' });
        
        if (po.status === 'approved' || po.status === 'received') {
            return res.status(400).json({ message: 'Locked Record: Cannot modify approved or received purchase orders.' });
        }

        let totalAmount = 0;
        const poItems = items.map(item => {
            totalAmount += (item.quantityOrdered * item.estimatedCost);
            return {
                itemId: item.itemId,
                name: item.name,
                sku: item.sku,
                quantityOrdered: item.quantityOrdered,
                estimatedCost: item.estimatedCost
            };
        });

        po.supplier = supplier;
        po.items = poItems;
        po.totalAmount = totalAmount;
        po.notes = notes;
        po.expectedDeliveryDate = expectedDeliveryDate;
        if (status) po.status = status;

        await po.save();
        res.json(po);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Approve PO Route - restricted to users with user.access.approvals clearance
router.post('/po/:id/approve', [auth, checkPermission('approvals', 'full')], async (req, res) => {
    try {
        // Fetch executing User object
        const User = require('../models/User');
        const executingUser = await User.findById(req.user.id);
        
        if (executingUser.role !== 'admin' && (!executingUser.access || (executingUser.access.approvals !== true && executingUser.access.approvals !== 'full'))) {
            return res.status(403).json({ message: 'Security Denied: You do not possess administrative approval clearance.' });
        }

        let po = await PurchaseOrder.findById(req.params.id);
        if (!po) return res.status(404).json({ message: 'Purchase Order not found' });
        
        if (po.status === 'approved') {
            return res.status(400).json({ message: 'Purchase Order has already been approved.' });
        }

        po.status = 'approved';
        po.approvedBy = req.user.id;
        await po.save();

        await AuditLog.create({
            userId: req.user.id,
            username: executingUser.username,
            action: 'PURCHASE_ORDER_APPROVED',
            module: 'SUPPLY_CHAIN',
            details: `Purchase Order ${po.poNumber} has been officially approved and released for GRN intake by executive authority.`,
            warehouseId: req.user.currentWarehouse
        });

        res.json(po);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Update PO Status directly
router.put('/po/:id/status', [auth, checkPermission('supply', 'full')], async (req, res) => {
    const { status } = req.body;
    try {
        const po = await PurchaseOrder.findByIdAndUpdate(req.params.id, { status }, { new: true });
        res.json(po);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// ==========================================
// GOODS RECEIVED NOTES (GRN) ENDPOINTS
// ==========================================

// Get all GRNs
router.get('/grn', [auth, checkPermission('supply', 'view')], async (req, res) => {
    try {
        let warehouseId = req.query.warehouseId || req.user.currentWarehouse;
        if (req.user.role !== 'admin') {
            warehouseId = req.user.currentWarehouse;
        }
        const query = {};
        if (warehouseId) {
            query.warehouseId = warehouseId;
        }
        const grns = await GRN.find(query).populate('receivedBy', 'username').sort({ createdAt: -1 });
        res.json(grns);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Create a GRN (Receiving Process)
// This process actually approves the stocks and inserts/merges the new batches into the Item schemas.
router.post('/grn', [auth, checkPermission('supply', 'full')], async (req, res) => {
    const { poRef, supplier, items, notes, status } = req.body;
    try {
        const User = require('../models/User');
        const userRecord = await User.findById(req.user.id);
        const operatorName = userRecord ? userRecord.username : 'System Operator';
        if (poRef) {
            const checkPO = await PurchaseOrder.findById(poRef);
            if (checkPO && checkPO.status !== 'approved') {
                return res.status(400).json({ message: 'Security Barrier: Referencing unauthorized PO. A Purchase Order must be "approved" prior to releasing GRN stocks.' });
            }
        }
        const grnCount = await GRN.countDocuments();
        const grnNumber = `GRN-${new Date().getFullYear()}-${(grnCount + 1).toString().padStart(4, '0')}`;

        let totalValue = 0;
        const grnItems = items.map(item => {
            totalValue += (item.quantityReceived * item.costPrice);
            return {
                itemId: item.itemId,
                name: item.name,
                batchNumber: item.batchNumber,
                expiryDate: item.expiryDate,
                quantityReceived: item.quantityReceived,
                costPrice: item.costPrice,
                sellingPrice: item.sellingPrice
            };
        });

        const newGRN = new GRN({
            grnNumber,
            poRef: poRef || null,
            supplier,
            items: grnItems,
            totalValue,
            receivedBy: req.user.id,
            status: status || 'approved',
            warehouseId: req.user.currentWarehouse,
            notes
        });

        if (newGRN.status === 'approved') {
            // Perform heavy atomic execution to reconcile the ledger inventory
            for (const grnItem of grnItems) {
                const itemRecord = await Item.findById(grnItem.itemId);
                if (itemRecord) {
                    // 1. Calculate current Moving Average Cost
                    const currentTotalVal = itemRecord.quantity * (itemRecord.movingAverageCost || itemRecord.price * 0.8); // fallback
                    const newIncomingVal = grnItem.quantityReceived * grnItem.costPrice;
                    const totalQtyAfter = itemRecord.quantity + grnItem.quantityReceived;
                    const calculatedMAC = totalQtyAfter > 0 ? (currentTotalVal + newIncomingVal) / totalQtyAfter : grnItem.costPrice;

                    // 2. Push into batch tracker array
                    const newBatch = {
                        batchNumber: grnItem.batchNumber,
                        expiryDate: grnItem.expiryDate ? new Date(grnItem.expiryDate) : null,
                        costPrice: grnItem.costPrice,
                        sellingPrice: grnItem.sellingPrice,
                        quantity: grnItem.quantityReceived,
                        status: 'active',
                        warehouseId: req.user.currentWarehouse
                    };

                    const Warehouse = require('../models/Warehouse');
                    const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
                    const defaultWHId = defaultWH ? String(defaultWH._id) : null;
                    const activeWHId = req.user.currentWarehouse ? String(req.user.currentWarehouse) : null;

                    // Check if batch exists, merge if identical or append if unique
                    const batchIdx = itemRecord.batches.findIndex(b => {
                        const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                        return b.batchNumber === grnItem.batchNumber && bWhId === activeWHId;
                    });
                    if (batchIdx > -1) {
                        itemRecord.batches[batchIdx].quantity += grnItem.quantityReceived;
                    } else {
                        itemRecord.batches.push(newBatch);
                    }

                    // 3. Update overall cumulative quantities and prices
                    itemRecord.quantity += grnItem.quantityReceived;
                    itemRecord.movingAverageCost = Number(calculatedMAC.toFixed(2));
                    // Optionally update standard floor base price to new batch selling price if needed or keep it
                    itemRecord.price = grnItem.sellingPrice;

                    await itemRecord.save();

                    // Write back to immutable audit tracking log
                    await AuditLog.create({
                        userId: req.user.id,
                        username: operatorName,
                        action: 'STOCK_GRN_RECEIPT',
                        module: 'SUPPLY_CHAIN',
                        details: `GRN approved. Received ${grnItem.quantityReceived} units of ${grnItem.name} (SKU: ${itemRecord.sku}) for Batch ${grnItem.batchNumber}. New item price locked at Rs.${grnItem.sellingPrice}.`,
                        warehouseId: req.user.currentWarehouse
                    });
                }
            }

            // If referencing a purchase order, update its status to 'received' or 'partially_received'
            if (poRef) {
                await PurchaseOrder.findByIdAndUpdate(poRef, { status: 'received' });
            }
        }

        await newGRN.save();
        res.json(newGRN);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Approve/Complete a Draft GRN
router.post('/grn/:id/approve', [auth, checkPermission('supply', 'full')], async (req, res) => {
    try {
        const User = require('../models/User');
        const userRecord = await User.findById(req.user.id);
        const operatorName = userRecord ? userRecord.username : 'System Operator';

        let grn = await GRN.findById(req.params.id);
        if (!grn) return res.status(404).json({ message: 'GRN not found' });
        
        if (grn.status === 'approved') {
            return res.status(400).json({ message: 'GRN has already been approved.' });
        }

        // Perform stock reconciliation
        for (const grnItem of grn.items) {
            const itemRecord = await Item.findById(grnItem.itemId);
            if (itemRecord) {
                const currentTotalVal = itemRecord.quantity * (itemRecord.movingAverageCost || itemRecord.price * 0.8);
                const newIncomingVal = grnItem.quantityReceived * grnItem.costPrice;
                const totalQtyAfter = itemRecord.quantity + grnItem.quantityReceived;
                const calculatedMAC = totalQtyAfter > 0 ? (currentTotalVal + newIncomingVal) / totalQtyAfter : grnItem.costPrice;

                const newBatch = {
                    batchNumber: grnItem.batchNumber,
                    expiryDate: grnItem.expiryDate ? new Date(grnItem.expiryDate) : null,
                    costPrice: grnItem.costPrice,
                    sellingPrice: grnItem.sellingPrice,
                    quantity: grnItem.quantityReceived,
                    status: 'active',
                    warehouseId: grn.warehouseId
                };

                const Warehouse = require('../models/Warehouse');
                const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
                const defaultWHId = defaultWH ? String(defaultWH._id) : null;
                const activeWHId = grn.warehouseId ? String(grn.warehouseId) : null;

                const batchIdx = itemRecord.batches.findIndex(b => {
                    const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                    return b.batchNumber === grnItem.batchNumber && bWhId === activeWHId;
                });
                if (batchIdx > -1) {
                    itemRecord.batches[batchIdx].quantity += grnItem.quantityReceived;
                } else {
                    itemRecord.batches.push(newBatch);
                }

                itemRecord.quantity += grnItem.quantityReceived;
                itemRecord.movingAverageCost = Number(calculatedMAC.toFixed(2));
                itemRecord.price = grnItem.sellingPrice;

                await itemRecord.save();

                await AuditLog.create({
                    userId: req.user.id,
                    username: operatorName,
                    action: 'STOCK_GRN_RECEIPT',
                    module: 'SUPPLY_CHAIN',
                    details: `GRN approved. Received ${grnItem.quantityReceived} units of ${grnItem.name} (SKU: ${itemRecord.sku}) for Batch ${grnItem.batchNumber}. New item price locked at Rs.${grnItem.sellingPrice}.`,
                    warehouseId: grn.warehouseId
                });
            }
        }

        if (grn.poRef) {
            await PurchaseOrder.findByIdAndUpdate(grn.poRef, { status: 'received' });
        }

        grn.status = 'approved';
        await grn.save();
        res.json(grn);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

const SupplierReturn = require('../models/SupplierReturn');

// ==========================================
// SUPPLIER RETURNS ENDPOINTS
// ==========================================

// Get all Supplier Returns
router.get('/returns', [auth, checkPermission('supply', 'view')], async (req, res) => {
    try {
        let warehouseId = req.query.warehouseId || req.user.currentWarehouse;
        if (req.user.role !== 'admin') {
            warehouseId = req.user.currentWarehouse;
        }
        const query = {};
        if (warehouseId) {
            query.warehouseId = warehouseId;
        }
        const returns = await SupplierReturn.find(query).populate('returnedBy', 'username').sort({ createdAt: -1 });
        res.json(returns);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Create a Supplier Return
router.post('/returns', [auth, checkPermission('supply', 'full')], async (req, res) => {
    const { grnRef, supplier, items, notes, reason, status } = req.body;
    try {
        const User = require('../models/User');
        const userRecord = await User.findById(req.user.id);
        const operatorName = userRecord ? userRecord.username : 'System Operator';

        const returnCount = await SupplierReturn.countDocuments();
        const returnNumber = `RTN-${new Date().getFullYear()}-${(returnCount + 1).toString().padStart(4, '0')}`;

        let totalValue = 0;
        const returnItems = items.map(item => {
            totalValue += (item.quantityReturned * item.unitCost);
            return {
                itemId: item.itemId,
                name: item.name,
                batchNumber: item.batchNumber,
                quantityReturned: item.quantityReturned,
                unitCost: item.unitCost
            };
        });

        const newReturn = new SupplierReturn({
            returnNumber,
            grnRef: grnRef || null,
            supplier,
            items: returnItems,
            totalValue,
            returnedBy: req.user.id,
            status: status || 'completed',
            warehouseId: req.user.currentWarehouse,
            reason,
            notes
        });

        if (newReturn.status === 'completed') {
            // Reconcile Inventory - Deduct Stock
            for (const rItem of returnItems) {
                const itemRecord = await Item.findById(rItem.itemId);
                if (itemRecord) {
                    // Find specific batch if possible
                    const Warehouse = require('../models/Warehouse');
                    const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
                    const defaultWHId = defaultWH ? String(defaultWH._id) : null;
                    const activeWHId = req.user.currentWarehouse ? String(req.user.currentWarehouse) : null;

                    const batchIdx = itemRecord.batches.findIndex(b => {
                        const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                        return b.batchNumber === rItem.batchNumber && bWhId === activeWHId;
                    });
                    if (batchIdx > -1) {
                        itemRecord.batches[batchIdx].quantity -= rItem.quantityReturned;
                    }

                    // Update overall quantity
                    itemRecord.quantity -= rItem.quantityReturned;
                    await itemRecord.save();

                    // Audit Log
                    await AuditLog.create({
                        userId: req.user.id,
                        username: operatorName,
                        action: 'SUPPLIER_RETURN',
                        module: 'SUPPLY_CHAIN',
                        details: `Supplier Return executed. Returned ${rItem.quantityReturned} units of ${rItem.name} from Batch ${rItem.batchNumber} to ${supplier}. Reason: ${reason}`,
                        warehouseId: req.user.currentWarehouse
                    });
                }
            }
        }

        await newReturn.save();
        res.json(newReturn);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Complete a Draft Return
router.post('/returns/:id/complete', [auth, checkPermission('supply', 'full')], async (req, res) => {
    try {
        const User = require('../models/User');
        const userRecord = await User.findById(req.user.id);
        const operatorName = userRecord ? userRecord.username : 'System Operator';

        let supplierReturn = await SupplierReturn.findById(req.params.id);
        if (!supplierReturn) return res.status(404).json({ message: 'Supplier Return not found' });
        
        if (supplierReturn.status === 'completed') {
            return res.status(400).json({ message: 'Return has already been completed.' });
        }

        // Reconcile Inventory - Deduct Stock
        for (const rItem of supplierReturn.items) {
            const itemRecord = await Item.findById(rItem.itemId);
            if (itemRecord) {
                const Warehouse = require('../models/Warehouse');
                const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
                const defaultWHId = defaultWH ? String(defaultWH._id) : null;
                const activeWHId = supplierReturn.warehouseId ? String(supplierReturn.warehouseId) : null;

                const batchIdx = itemRecord.batches.findIndex(b => {
                    const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                    return b.batchNumber === rItem.batchNumber && bWhId === activeWHId;
                });
                if (batchIdx > -1) {
                    itemRecord.batches[batchIdx].quantity -= rItem.quantityReturned;
                }

                // Update overall quantity
                itemRecord.quantity -= rItem.quantityReturned;
                await itemRecord.save();

                // Audit Log
                await AuditLog.create({
                    userId: req.user.id,
                    username: operatorName,
                    action: 'SUPPLIER_RETURN',
                    module: 'SUPPLY_CHAIN',
                    details: `Supplier Return executed. Returned ${rItem.quantityReturned} units of ${rItem.name} from Batch ${rItem.batchNumber} to ${supplierReturn.supplier}. Reason: ${supplierReturn.reason}`,
                    warehouseId: supplierReturn.warehouseId
                });
            }
        }

        supplierReturn.status = 'completed';
        await supplierReturn.save();
        res.json(supplierReturn);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
