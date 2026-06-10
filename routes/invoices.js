const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');
const SystemSetting = require('../models/SystemSetting');

// Get all formal commercial invoices
router.get('/', [auth, checkPermission('invoices', 'view')], async (req, res) => {
    try {
        let warehouseId = req.query.warehouseId || req.user.currentWarehouse;
        if (req.user.role !== 'admin') {
            warehouseId = req.user.currentWarehouse;
        }
        const query = {};
        if (warehouseId) {
            query.warehouseId = warehouseId;
        }
        const invoices = await Invoice.find(query).populate('customerId', 'name email').sort({ createdAt: -1 }).lean();
        res.json(invoices);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Create a new Commercial Invoice
router.post('/', [auth, checkPermission('invoices', 'full')], async (req, res) => {
    const { customerId, items, paymentTerms, dueDate, notes, discountTotal, status } = req.body;
    
    try {
        const settings = await SystemSetting.findOne();
        const useCostPrice = settings ? settings.useCostPrice : true;
        const useBatchNumbers = settings ? settings.useBatchNumbers : true;

        const invoiceCount = await Invoice.countDocuments();
        const invoiceNumber = `INV-B2B-${new Date().getFullYear()}-${(invoiceCount + 1).toString().padStart(5, '0')}`;

        let customerDetails = {};
        if (customerId) {
            const customer = await Customer.findById(customerId);
            if (customer) {
                customerDetails = {
                    name: customer.name,
                    email: customer.email,
                    phone: customer.phone,
                    address: customer.address
                };
            }
        } else {
            customerDetails = req.body.customerDetails || { name: 'Anonymous Corporate' };
        }

        let subtotal = 0;
        let taxTotal = 0;
        const invoiceItems = items.map(item => {
            const itemCost = useCostPrice !== false ? (item.costPrice || 0) : (item.price || 0);
            const itemSub = item.quantity * itemCost;
            subtotal += itemSub;
            taxTotal += (itemSub * (item.taxRate || 0) / 100);
            
            return {
                itemId: item.itemId,
                name: item.name,
                quantity: item.quantity,
                price: item.price || 0,
                costPrice: itemCost,
                sellingPrice: item.price || 0,
                batchNumber: item.batchNumber || '',
                expiryDate: item.expiryDate || null,
                taxRate: item.taxRate || 0,
                subtotal: itemSub
            };
        });

        const discount = parseFloat(discountTotal) || 0;
        const grandTotal = subtotal + taxTotal - discount;
        const invoiceStatus = status || 'draft';

        const newInvoice = new Invoice({
            invoiceNumber,
            customerId: customerId || null,
            customerDetails,
            items: invoiceItems,
            subtotal,
            taxTotal,
            discountTotal: discount,
            grandTotal,
            status: invoiceStatus,
            paymentTerms: paymentTerms || 'Due on receipt',
            dueDate: new Date(dueDate || new Date().setDate(new Date().getDate() + 15)), // default 15 days
            createdBy: req.user.id,
            warehouseId: req.user.currentWarehouse,
            notes
        });

        // Deduct inventory stock ONLY if invoice is saved as completed or paid (NOT on draft!)
        if (invoiceStatus !== 'draft') {
            const Item = require('../models/Item');
            const Warehouse = require('../models/Warehouse');
            const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
            const defaultWHId = defaultWH ? String(defaultWH._id) : null;
            const targetWHId = newInvoice.warehouseId ? String(newInvoice.warehouseId) : (req.user.currentWarehouse ? String(req.user.currentWarehouse) : null);

            for (const invItem of invoiceItems) {
                const itemRecord = await Item.findById(invItem.itemId);
                if (itemRecord) {
                    itemRecord.quantity -= invItem.quantity;
                    if (useBatchNumbers !== false && invItem.batchNumber) {
                        const batchIdx = itemRecord.batches.findIndex(b => {
                            const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                            return b.batchNumber === invItem.batchNumber && bWhId === String(targetWHId);
                        });
                        if (batchIdx > -1) {
                            itemRecord.batches[batchIdx].quantity -= invItem.quantity;
                        }
                    } else if (itemRecord.batches && itemRecord.batches.length > 0) {
                        let remaining = invItem.quantity;
                        for (let b of itemRecord.batches) {
                            const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                            if (targetWHId && bWhId !== targetWHId) {
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
                    await itemRecord.save();
                }
            }

            // Adjust customer receivables balance if completed (unpaid) or push purchase history
            if (customerId) {
                const customer = await Customer.findById(customerId);
                if (customer) {
                    customer.purchaseHistory.push({
                        amount: grandTotal,
                        date: new Date()
                    });
                    if (invoiceStatus === 'completed') {
                        customer.currentBalance += grandTotal;
                    }
                    await customer.save();
                }
            }
        }

        await newInvoice.save();

        // Audit trail logging
        const User = require('../models/User');
        const userRecord = await User.findById(req.user.id);
        const operatorName = userRecord ? userRecord.username : 'System Operator';

        await AuditLog.create({
            userId: req.user.id,
            username: operatorName,
            action: 'INVOICE_B2B_CREATED',
            module: 'INVOICE_MODULE',
            details: `Generated formal B2B invoice ${invoiceNumber} (${invoiceStatus}) for customer ${customerDetails.name}. Total: Rs.${grandTotal}.`,
            warehouseId: req.user.currentWarehouse
        });

        res.json(newInvoice);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Update invoice status & workflow transitions
router.put('/:id/status', [auth, checkPermission('invoices', 'full')], async (req, res) => {
    const { status } = req.body;
    try {
        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ message: 'Invoice missing.' });

        const oldStatus = invoice.status;
        if (oldStatus === status) {
            return res.json(invoice);
        }

        invoice.status = status;

        // Transition 1: From draft to completed or paid -> Trigger stock deduction and set up receivables
        if (oldStatus === 'draft' && (status === 'completed' || status === 'paid')) {
            const settings = await SystemSetting.findOne();
            const useBatchNumbers = settings ? settings.useBatchNumbers : true;

            const Item = require('../models/Item');
            const Warehouse = require('../models/Warehouse');
            const defaultWH = await Warehouse.findOne({ code: 'WH-MAIN' });
            const defaultWHId = defaultWH ? String(defaultWH._id) : null;
            const targetWHId = invoice.warehouseId ? String(invoice.warehouseId) : (req.user.currentWarehouse ? String(req.user.currentWarehouse) : null);

            for (const invItem of invoice.items) {
                const itemRecord = await Item.findById(invItem.itemId);
                if (itemRecord) {
                    itemRecord.quantity -= invItem.quantity;
                    if (useBatchNumbers !== false && invItem.batchNumber) {
                        const batchIdx = itemRecord.batches.findIndex(b => {
                            const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                            return b.batchNumber === invItem.batchNumber && bWhId === String(targetWHId);
                        });
                        if (batchIdx > -1) {
                            itemRecord.batches[batchIdx].quantity -= invItem.quantity;
                        }
                    } else if (itemRecord.batches && itemRecord.batches.length > 0) {
                        let remaining = invItem.quantity;
                        for (let b of itemRecord.batches) {
                            const bWhId = b.warehouseId ? String(b.warehouseId) : defaultWHId;
                            if (targetWHId && bWhId !== targetWHId) {
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
                    await itemRecord.save();
                }
            }

            if (invoice.customerId) {
                const customer = await Customer.findById(invoice.customerId);
                if (customer) {
                    customer.purchaseHistory.push({
                        amount: invoice.grandTotal,
                        date: new Date()
                    });
                    if (status === 'completed') {
                        customer.currentBalance += invoice.grandTotal;
                    }
                    await customer.save();
                }
            }
        }

        // Transition 2: From completed to paid -> Reconcile balance tab (deduct invoice total from outstanding customer receivable balance)
        if (oldStatus === 'completed' && status === 'paid' && invoice.customerId) {
            await Customer.findByIdAndUpdate(invoice.customerId, {
                $inc: { currentBalance: -invoice.grandTotal }
            });
        }

        await invoice.save();

        // Audit trail logging
        const User = require('../models/User');
        const userRecord = await User.findById(req.user.id);
        const operatorName = userRecord ? userRecord.username : 'System Operator';

        await AuditLog.create({
            userId: req.user.id,
            username: operatorName,
            action: 'INVOICE_STATUS_UPDATED',
            module: 'INVOICE_MODULE',
            details: `Invoice ${invoice.invoiceNumber} status shifted from ${oldStatus} to ${status}.`,
            warehouseId: req.user.currentWarehouse
        });

        res.json(invoice);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
