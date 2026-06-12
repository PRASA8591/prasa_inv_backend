const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { checkLicenseLimits } = require('../middleware/licenseGuard');

// Dynamic ACL Clearance Middleware: Allows access if operator is admin OR has Whitelisted access.users.
const checkUsersClearance = (requiredLevel = 'view') => {
    return async (req, res, next) => {
        try {
            const currentUser = await User.findById(req.user.id);
            if (!currentUser) {
                return res.status(401).json({ message: 'Invalid operator session.' });
            }
            if (currentUser.role === 'admin') {
                return next();
            }
            const access = currentUser.access || {};
            let hasAccess = false;
            if (requiredLevel === 'full') {
                hasAccess = access.users_edit === true;
            } else {
                hasAccess = access.users === true;
            }
            if (hasAccess) {
                return next();
            }
            return res.status(403).json({ message: `Access denied. Identity lacks whitelisted "users" clearance.` });
        } catch (err) {
            res.status(500).send('Security handshake error.');
        }
    };
};

// @route   GET api/users
// @desc    Get all users
// @access  Private (Requires admin OR access.users whitelist)
router.get('/', [auth, checkUsersClearance('view')], async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 }).lean();
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/users
// @desc    Create a new user manually by admin
// @access  Private (Requires admin OR access.users whitelist)
router.post('/', [auth, checkUsersClearance('full'), checkLicenseLimits('user')], async (req, res) => {
    const { username, password, role, access, allowedWarehouses } = req.body;
    try {
        const operator = await User.findById(req.user.id);
        if (!operator) {
            return res.status(401).json({ message: 'Invalid operator session.' });
        }

        // Prevent a non-admin from creating an admin account
        if (role === 'admin' && operator.role !== 'admin') {
            return res.status(403).json({ message: 'Only administrators can create administrator accounts.' });
        }

        let user = await User.findOne({ username });
        if (user) {
            return res.status(400).json({ message: 'Username already taken' });
        }

        user = new User({
            username,
            password,
            role: role || 'user',
            access: access || {
                dashboard: true,
                items: true,
                items_edit: true,
                stock: true,
                stock_edit: true,
                pos: true,
                price: true,
                crm: false,
                crm_edit: false,
                supply: false,
                supply_edit: false,
                invoices: false,
                invoices_edit: false,
                users: false,
                users_edit: false,
                reports: true,
                settings: false,
                approvals: false,
                recent_bills: false,
                direct_stock: true
            },
            allowedWarehouses: allowedWarehouses || []
        });

        if (allowedWarehouses && allowedWarehouses.length > 0) {
            user.currentWarehouse = allowedWarehouses[0];
        } else {
            const Warehouse = require('../models/Warehouse');
            const mainWh = await Warehouse.findOne({ code: 'WH-MAIN' });
            if (mainWh) user.currentWarehouse = mainWh._id;
        }

        // If role is admin, force all access to true
        if (role === 'admin') {
            user.access = {
                dashboard: true,
                items: true,
                items_edit: true,
                stock: true,
                stock_edit: true,
                pos: true,
                price: true,
                crm: true,
                crm_edit: true,
                supply: true,
                supply_edit: true,
                invoices: true,
                invoices_edit: true,
                users: true,
                users_edit: true,
                reports: true,
                settings: true,
                approvals: true,
                recent_bills: true,
                direct_stock: true
            };
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        await user.save();

        // Write AuditLog
        const AuditLog = require('../models/AuditLog');
        await AuditLog.create({
            userId: req.user.id,
            username: operator.username,
            action: 'USER_CREATED',
            module: 'USERS',
            details: `Created new user account: "${username}" with role: "${role || 'user'}"`,
            warehouseId: operator.currentWarehouse,
            ipAddress: req.ip
        });

        const userObj = user.toObject();
        delete userObj.password;
        res.json(userObj);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   PUT api/users/:id
// @desc    Update user info, role, access or password
// @access  Private (Requires admin OR access.users whitelist)
router.put('/:id', [auth, checkUsersClearance('full')], async (req, res) => {
    const { role, access, password, allowedWarehouses } = req.body;
    try {
        let user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const operator = await User.findById(req.user.id);
        if (!operator) {
            return res.status(401).json({ message: 'Invalid operator session.' });
        }

        // Only admin can change admin account
        if (user.role === 'admin' && operator.role !== 'admin') {
            return res.status(403).json({ message: 'Only administrators can modify administrator accounts.' });
        }

        // Only admin can promote any user to admin
        if (role === 'admin' && operator.role !== 'admin') {
            return res.status(403).json({ message: 'Only administrators can assign the administrator role.' });
        }

        if (role !== undefined) user.role = role;
        if (access !== undefined) {
            user.access = access;
            user.markModified('access');
        }
        if (allowedWarehouses !== undefined) {
            user.allowedWarehouses = allowedWarehouses;
            if (user.role !== 'admin') {
                if (allowedWarehouses.length > 0) {
                    if (!user.currentWarehouse || !allowedWarehouses.some(id => String(id) === String(user.currentWarehouse))) {
                        user.currentWarehouse = allowedWarehouses[0];
                    }
                } else {
                    user.currentWarehouse = undefined;
                }
            }
        }

        // Handle role-based overrides
        if (user.role === 'admin') {
            user.access = {
                dashboard: true,
                items: true,
                items_edit: true,
                stock: true,
                stock_edit: true,
                pos: true,
                price: true,
                crm: true,
                crm_edit: true,
                supply: true,
                supply_edit: true,
                invoices: true,
                invoices_edit: true,
                users: true,
                users_edit: true,
                reports: true,
                settings: true,
                approvals: true,
                recent_bills: true,
                direct_stock: true
            };
            user.markModified('access');
        }

        // Update password if sent
        if (password && password.trim() !== '') {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }

        await user.save();

        // Write AuditLog
        const AuditLog = require('../models/AuditLog');
        await AuditLog.create({
            userId: req.user.id,
            username: operator.username,
            action: 'USER_UPDATED',
            module: 'USERS',
            details: `Updated user account settings for "${user.username}" (Role: "${user.role}")`,
            warehouseId: operator.currentWarehouse,
            ipAddress: req.ip
        });

        const userObj = user.toObject();
        delete userObj.password;
        res.json(userObj);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   DELETE api/users/:id
// @desc    Delete a user
// @access  Private (Requires admin OR access.users whitelist)
router.delete('/:id', [auth, checkUsersClearance('full')], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Prevent deletion of any admin account
        if (user.role === 'admin') {
            return res.status(403).json({ message: 'Administrator accounts cannot be deleted.' });
        }

        // Prevent self-deletion
        if (user._id.toString() === req.user.id) {
            return res.status(400).json({ message: 'You cannot delete your own admin account' });
        }

        await User.findByIdAndDelete(req.params.id);

        // Write AuditLog
        const operator = await User.findById(req.user.id);
        const AuditLog = require('../models/AuditLog');
        await AuditLog.create({
            userId: req.user.id,
            username: operator ? operator.username : 'Unknown',
            action: 'USER_DELETED',
            module: 'USERS',
            details: `Deleted user account: "${user.username}"`,
            warehouseId: operator ? operator.currentWarehouse : undefined,
            ipAddress: req.ip
        });

        res.json({ message: 'User deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

module.exports = router;
