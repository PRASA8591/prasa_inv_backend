const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

// @route   POST api/auth/register
// @desc    Register user
// @access  Public
router.post('/register', async (req, res) => {
    const { username, password, role } = req.body;

    try {
        let user = await User.findOne({ username });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        user = new User({
            username,
            password,
            role: role || 'user'
        });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);

        await user.save();

        const payload = {
            user: {
                id: user.id,
                role: user.role
            }
        };

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '24h' },
            (err, token) => {
                if (err) throw err;
                res.json({ token });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// Simple In-Memory Rate Limiter for Login Endpoint
const loginAttempts = {};
const rateLimitLogin = (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    
    if (!loginAttempts[ip]) {
        loginAttempts[ip] = [];
    }
    
    // Filter attempts in the last 1 minute (60000 ms)
    loginAttempts[ip] = loginAttempts[ip].filter(timestamp => now - timestamp < 60000);
    
    if (loginAttempts[ip].length >= 10) {
        return res.status(429).json({ message: 'Too many login attempts. Please try again after a minute.' });
    }
    
    loginAttempts[ip].push(now);
    next();
};

// @route   POST api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', rateLimitLogin, async (req, res) => {
    const { username, password } = req.body;

    try {
        let user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Location configuration and verification
        const Warehouse = require('../models/Warehouse');
        let needsSave = false;

        const activeWarehouses = await Warehouse.find({ status: 'active' });
        const activeWarehouseIds = activeWarehouses.map(w => String(w._id));

        if (user.role !== 'admin') {
            // Standard users (manager/user) must have allowed location list
            if (!user.allowedWarehouses || user.allowedWarehouses.length === 0) {
                return res.status(400).json({ message: 'Login denied. Identity lacks assigned location access permissions.' });
            }

            // Filter user's allowed warehouses to only active ones
            const activeAllowedWarehouseIds = user.allowedWarehouses.filter(id => activeWarehouseIds.includes(String(id)));
            if (activeAllowedWarehouseIds.length === 0) {
                return res.status(400).json({ message: 'Login denied. Your assigned locations are suspended.' });
            }

            // If current warehouse is not active or not in allowed list, switch to the first active allowed one
            if (!user.currentWarehouse || 
                !activeWarehouseIds.includes(String(user.currentWarehouse)) || 
                !user.allowedWarehouses.some(id => String(id) === String(user.currentWarehouse))) {
                user.currentWarehouse = activeAllowedWarehouseIds[0];
                needsSave = true;
            }
        } else {
            // Admin user
            // If current warehouse is not active, try to switch to the first active one in the system
            if (!user.currentWarehouse || !activeWarehouseIds.includes(String(user.currentWarehouse))) {
                const mainWh = await Warehouse.findOne({ isMain: true, status: 'active' }) || 
                               await Warehouse.findOne({ code: 'WH-MAIN', status: 'active' }) || 
                               await Warehouse.findOne({ status: 'active' });
                if (mainWh) {
                    user.currentWarehouse = mainWh._id;
                    needsSave = true;
                } else if (!user.currentWarehouse) {
                    // Fallback to any warehouse if there are absolutely none active
                    const anyWh = await Warehouse.findOne();
                    if (anyWh) {
                        user.currentWarehouse = anyWh._id;
                        needsSave = true;
                    }
                }
            }
        }

        if (needsSave) {
            await user.save();
        }

        // Log login success
        const AuditLog = require('../models/AuditLog');
        await AuditLog.create({
            userId: user.id,
            username: user.username,
            action: 'LOGIN',
            module: 'AUTH',
            details: `User "${user.username}" logged in successfully`,
            warehouseId: user.currentWarehouse,
            ipAddress: req.ip
        });

        const payload = {
            user: {
                id: user.id,
                role: user.role,
                currentWarehouse: user.currentWarehouse
            }
        };

        let populatedUser = await User.findById(user.id)
            .select('-password')
            .populate('currentWarehouse')
            .populate('allowedWarehouses');

        if (populatedUser.role === 'admin') {
            const allWarehouses = await Warehouse.find({ status: 'active' });
            populatedUser = populatedUser.toObject();
            populatedUser.allowedWarehouses = allWarehouses;
        }

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '24h' },
            (err, token) => {
                if (err) throw err;
                res.json({ token, user: populatedUser });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   GET api/auth/user
// @desc    Get current user
// @access  Private
router.get('/user', auth, async (req, res) => {
    try {
        let userObj = await User.findById(req.user.id)
            .select('-password')
            .populate('currentWarehouse')
            .populate('allowedWarehouses');
        
        if (!userObj) {
            return res.status(404).json({ message: 'User not found' });
        }

        const Warehouse = require('../models/Warehouse');

        // Check if active warehouse is suspended/inactive
        if (userObj.role !== 'admin') {
            const activeWarehouses = await Warehouse.find({ status: 'active' });
            const activeWarehouseIds = activeWarehouses.map(w => String(w._id));
            
            const activeAllowedWarehouses = userObj.allowedWarehouses.filter(w => w.status === 'active');
            if (activeAllowedWarehouses.length === 0) {
                return res.status(401).json({ message: 'Session terminated. Your assigned locations are suspended.' });
            }

            if (!userObj.currentWarehouse || userObj.currentWarehouse.status !== 'active') {
                const dbUser = await User.findById(req.user.id);
                dbUser.currentWarehouse = activeAllowedWarehouses[0]._id;
                await dbUser.save();
                
                // Reload populated user
                userObj = await User.findById(req.user.id)
                    .select('-password')
                    .populate('currentWarehouse')
                    .populate('allowedWarehouses');
            }
        } else {
            // Admin user
            if (userObj.currentWarehouse && userObj.currentWarehouse.status !== 'active') {
                const activeWh = await Warehouse.findOne({ status: 'active' });
                if (activeWh) {
                    const dbUser = await User.findById(req.user.id);
                    dbUser.currentWarehouse = activeWh._id;
                    await dbUser.save();

                    // Reload populated user
                    userObj = await User.findById(req.user.id)
                        .select('-password')
                        .populate('currentWarehouse')
                        .populate('allowedWarehouses');
                }
            }
        }

        if (userObj.role === 'admin') {
            const allWarehouses = await Warehouse.find({ status: 'active' });
            userObj = userObj.toObject ? userObj.toObject() : userObj;
            userObj.allowedWarehouses = allWarehouses;
        }

        res.json(userObj);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/auth/switch-location
// @desc    Switch active session warehouse location
// @access  Private
router.post('/switch-location', auth, async (req, res) => {
    const { warehouseId } = req.body;
    if (!warehouseId) {
        return res.status(400).json({ message: 'Warehouse ID is required' });
    }

    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const Warehouse = require('../models/Warehouse');
        const targetWarehouse = await Warehouse.findById(warehouseId);
        if (!targetWarehouse) {
            return res.status(404).json({ message: 'Selected location not found.' });
        }
        if (targetWarehouse.status !== 'active') {
            return res.status(400).json({ message: 'Cannot switch to a suspended location.' });
        }

        // Validate location switcher permissions
        if (user.role !== 'admin') {
            const hasAccess = user.allowedWarehouses.some(id => String(id) === String(warehouseId));
            if (!hasAccess) {
                return res.status(403).json({ message: 'Access denied. You do not have permissions for this location.' });
            }
        }

        user.currentWarehouse = warehouseId;
        await user.save();

        const payload = {
            user: {
                id: user.id,
                role: user.role,
                currentWarehouse: user.currentWarehouse
            }
        };

        let populatedUser = await User.findById(user.id)
            .select('-password')
            .populate('currentWarehouse')
            .populate('allowedWarehouses');

        if (populatedUser.role === 'admin') {
            const Warehouse = require('../models/Warehouse');
            const allWarehouses = await Warehouse.find({ status: 'active' });
            populatedUser = populatedUser.toObject();
            populatedUser.allowedWarehouses = allWarehouses;
        }

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '24h' },
            (err, token) => {
                if (err) throw err;
                res.json({ token, user: populatedUser });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
