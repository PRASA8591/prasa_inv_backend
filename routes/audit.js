const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');

// Get recent audit log trails
router.get('/', auth, async (req, res) => {
    try {
        // Check if operator is admin OR has access.audit_logs clearance
        const User = require('../models/User');
        const currentUser = await User.findById(req.user.id);
        if (!currentUser) {
            return res.status(401).json({ message: 'Invalid operator session.' });
        }
        if (currentUser.role !== 'admin' && (!currentUser.access || !currentUser.access.audit_logs)) {
            return res.status(403).json({ message: 'Insufficient Clearance level: Requires "audit_logs" clearance.' });
        }

        const query = {};
        if (req.query.warehouseId) {
            query.warehouseId = req.query.warehouseId;
        }

        const logs = await AuditLog.find(query).sort({ timestamp: -1 }).limit(100).lean();
        res.json(logs);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
