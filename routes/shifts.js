const express = require('express');
const router = express.Router();
const Shift = require('../models/Shift');
const auth = require('../middleware/auth');

// Get all shifts history
router.get('/', auth, async (req, res) => {
    try {
        let warehouseId = req.query.warehouseId || req.user.currentWarehouse;
        if (req.user.role !== 'admin') {
            warehouseId = req.user.currentWarehouse;
        }
        const query = {};
        if (warehouseId) {
            query.warehouseId = warehouseId;
        }
        const shifts = await Shift.find(query)
            .populate('userId', 'username')
            .sort({ startTime: -1 })
            .lean();
        res.json(shifts);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Get active shift for current user
router.get('/active', auth, async (req, res) => {
    try {
        const activeShift = await Shift.findOne({ userId: req.user.id, status: 'open', warehouseId: req.user.currentWarehouse }).lean();
        res.json(activeShift);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Open a new shift with start float
router.post('/open', auth, async (req, res) => {
    const { startFloat, notes } = req.body;
    try {
        // Verify if another open shift exists
        const existing = await Shift.findOne({ userId: req.user.id, status: 'open', warehouseId: req.user.currentWarehouse });
        if (existing) {
            return res.status(400).json({ message: 'You already possess an active shift terminal open.', shift: existing });
        }

        const newShift = new Shift({
            userId: req.user.id,
            startFloat: parseFloat(startFloat) || 0,
            expectedDrawerAmount: parseFloat(startFloat) || 0,
            warehouseId: req.user.currentWarehouse,
            notes
        });

        await newShift.save();
        res.json(newShift);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Close a shift and record audit checks
router.post('/close/:id', auth, async (req, res) => {
    const { actualDrawerAmount, notes } = req.body;
    try {
        const shift = await Shift.findById(req.params.id);
        if (!shift) return res.status(404).json({ message: 'Shift not found.' });
        if (shift.status === 'closed') return res.status(400).json({ message: 'Shift has already been closed.' });

        const actual = parseFloat(actualDrawerAmount) || 0;
        
        shift.actualDrawerAmount = actual;
        shift.difference = actual - shift.expectedDrawerAmount;
        shift.status = 'closed';
        shift.endTime = new Date();
        shift.notes = (shift.notes || '') + '\nClosing note: ' + (notes || '');

        await shift.save();
        res.json(shift);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
