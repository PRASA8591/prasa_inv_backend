const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/permission');

// @route   GET api/customers
// @desc    Get all customers
// @access  Private
router.get('/', [auth, checkPermission('crm', 'view')], async (req, res) => {
    try {
        let warehouseId = req.query.warehouseId || req.user.currentWarehouse;
        if (req.user.role !== 'admin') {
            warehouseId = req.user.currentWarehouse;
        }
        
        const { type } = req.query;
        const query = {};
        
        if (type) {
            query.type = type;
            if (type === 'Customer' && warehouseId) {
                query.warehouseId = warehouseId;
            }
        } else {
            if (warehouseId) {
                query.$or = [
                    { type: { $in: ['Supplier', 'Seller'] } },
                    { 
                        $and: [
                            { $or: [{ type: 'Customer' }, { type: { $exists: false } }] },
                            { warehouseId }
                        ]
                    }
                ];
            }
        }
        
        const customers = await Customer.find(query).sort({ name: 1 }).lean();
        res.json(customers);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/customers
// @desc    Create a customer profile
router.post('/', [auth, checkPermission('crm', 'full')], async (req, res) => {
    const { title, name, phone, email, address, category, creditLimit, notes, type } = req.body;
    try {
        const entityType = type || 'Customer';
        
        const existingQuery = { phone, type: entityType };
        if (entityType === 'Customer') {
            existingQuery.warehouseId = req.user.currentWarehouse;
        }
        
        let customer = await Customer.findOne(existingQuery);
        if (customer) {
            return res.status(400).json({ message: `${entityType} already registered with this phone number.` });
        }

        customer = new Customer({
            title,
            name,
            phone,
            email,
            address,
            category: entityType === 'Customer' ? (category || 'Retail') : undefined,
            creditLimit: entityType === 'Customer' ? (creditLimit || 0) : 0,
            warehouseId: entityType === 'Customer' ? req.user.currentWarehouse : null,
            notes,
            type: entityType
        });

        await customer.save();
        res.json(customer);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/customers/:id
// @desc    Update customer details
router.put('/:id', [auth, checkPermission('crm', 'full')], async (req, res) => {
    const { title, name, phone, email, address, category, creditLimit, currentBalance, loyaltyPoints, notes, type } = req.body;

    const updateFields = {};
    if (title !== undefined) updateFields.title = title;
    if (name) updateFields.name = name;
    if (phone) updateFields.phone = phone;
    if (email !== undefined) updateFields.email = email;
    if (address !== undefined) updateFields.address = address;
    if (category !== undefined) updateFields.category = category;
    if (creditLimit !== undefined) updateFields.creditLimit = creditLimit;
    if (currentBalance !== undefined) updateFields.currentBalance = currentBalance;
    if (loyaltyPoints !== undefined) updateFields.loyaltyPoints = loyaltyPoints;
    if (notes !== undefined) updateFields.notes = notes;
    if (type !== undefined) {
        updateFields.type = type;
        if (type === 'Supplier' || type === 'Seller') {
            updateFields.warehouseId = null;
        } else if (type === 'Customer') {
            updateFields.warehouseId = req.user.currentWarehouse;
        }
    }

    try {
        let customer = await Customer.findById(req.params.id);
        if (!customer) return res.status(404).json({ message: 'Customer profile not found.' });

        customer = await Customer.findByIdAndUpdate(
            req.params.id,
            { $set: updateFields },
            { new: true }
        );
        res.json(customer);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE api/customers/:id
// @desc    Delete a customer profile
router.delete('/:id', [auth, checkPermission('crm', 'full')], async (req, res) => {
    try {
        const customer = await Customer.findById(req.params.id);
        if (!customer) return res.status(404).json({ message: 'Customer not found.' });
        
        await Customer.findByIdAndDelete(req.params.id);
        res.json({ message: 'Customer records removed.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/customers/:id/deposit
// @desc    Deposit advance store credit into customer wallet
// @access  Private
router.post('/:id/deposit', [auth, checkPermission('crm', 'full')], async (req, res) => {
    const { amount, details } = req.body;
    if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ message: 'Please enter a valid deposit amount.' });
    }

    try {
        const customer = await Customer.findById(req.params.id);
        if (!customer) return res.status(404).json({ message: 'Customer profile not found.' });

        customer.currentBalance -= amount;
        customer.walletTransactions.push({
            amount,
            type: 'deposit',
            details: details || 'Cash Deposit'
        });

        await customer.save();
        res.json(customer);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
