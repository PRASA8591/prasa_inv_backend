const express = require('express');
const router = express.Router();
const Warehouse = require('../models/Warehouse');
const auth = require('../middleware/auth');
const User = require('../models/User');
const checkPermission = require('../middleware/permission');
const { checkLicenseLimits } = require('../middleware/licenseGuard');

// @route   GET api/warehouses
// @desc    Get all warehouses
// @access  Private
router.get('/', auth, async (req, res) => {
    try {
        const warehouses = await Warehouse.find().sort({ name: 1 }).lean();
        res.json(warehouses);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/warehouses
// @desc    Create a new warehouse
// @access  Private
router.post('/', [auth, checkPermission('locations', 'full'), checkLicenseLimits('warehouse')], async (req, res) => {
    const { name, code, address, status, phone, email, type, manager, allowedPages, isMain } = req.body;
    if (!name || !code) {
        return res.status(400).json({ message: 'Name and Code are required' });
    }

    try {
        let warehouse = await Warehouse.findOne({ $or: [{ name }, { code: code.toUpperCase() }] });
        if (warehouse) {
            return res.status(400).json({ message: 'Warehouse with this name or code already exists.' });
        }

        warehouse = new Warehouse({
            name,
            code: code.toUpperCase(),
            address,
            phone: phone || '',
            email: email || '',
            type: type || 'Warehouse',
            manager: manager || '',
            status: status || 'active',
            allowedPages: allowedPages || ['dashboard', 'items', 'stock', 'transfers', 'shifts', 'direct_stock', 'pos', 'price', 'crm', 'supply', 'invoices', 'users', 'reports', 'settings', 'locations'],
            isMain: isMain || false
        });

        await warehouse.save();

        if (warehouse.isMain) {
            await Warehouse.updateMany({ _id: { $ne: warehouse._id } }, { $set: { isMain: false } });
        }

        res.json(warehouse);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/warehouses/:id
// @desc    Update warehouse details
// @access  Private
router.put('/:id', [auth, checkPermission('locations', 'full')], async (req, res) => {
    const { name, code, address, status, phone, email, type, manager, allowedPages, isMain } = req.body;
    
    const updateFields = {};
    if (name) updateFields.name = name;
    if (code) updateFields.code = code.toUpperCase();
    if (address !== undefined) updateFields.address = address;
    if (status) updateFields.status = status;
    if (phone !== undefined) updateFields.phone = phone;
    if (email !== undefined) updateFields.email = email;
    if (type !== undefined) updateFields.type = type;
    if (manager !== undefined) updateFields.manager = manager;
    if (allowedPages !== undefined) updateFields.allowedPages = allowedPages;
    if (isMain !== undefined) updateFields.isMain = isMain;

    try {
        let warehouse = await Warehouse.findById(req.params.id);
        if (!warehouse) return res.status(404).json({ message: 'Warehouse not found.' });

        warehouse = await Warehouse.findByIdAndUpdate(
            req.params.id,
            { $set: updateFields },
            { new: true }
        );

        if (warehouse.isMain) {
            await Warehouse.updateMany({ _id: { $ne: warehouse._id } }, { $set: { isMain: false } });
        }

        res.json(warehouse);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE api/warehouses/:id
// @desc    Delete a warehouse
// @access  Private
router.delete('/:id', [auth, checkPermission('locations', 'full')], async (req, res) => {
    try {
        const warehouse = await Warehouse.findById(req.params.id);
        if (!warehouse) return res.status(404).json({ message: 'Warehouse not found.' });

        // Check if there are active batches assigned to this warehouse
        const Item = require('../models/Item');
        const count = await Item.countDocuments({ 'batches.warehouseId': req.params.id });
        if (count > 0) {
            return res.status(400).json({ message: 'Cannot delete warehouse that contains item batches. Transfer stock first.' });
        }

        await Warehouse.findByIdAndDelete(req.params.id);
        res.json({ message: 'Warehouse deleted.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
