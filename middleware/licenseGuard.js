const SystemSetting = require('../models/SystemSetting');
const User = require('../models/User');
const Warehouse = require('../models/Warehouse');
const Item = require('../models/Item');

/**
 * Middleware to check active license status.
 * If expired/deactivated, blocks standard users from performing any operations.
 */
const checkLicenseActive = async (req, res, next) => {
    try {
        const settings = await SystemSetting.findOne().lean();
        if (!settings) {
            // If no settings exist yet, allow operation to set it up
            return next();
        }

        const isExpired = (() => {
            if (settings.activationStatus !== 'active') return true;
            if (settings.activationExpiryDate) {
                const expiry = new Date(settings.activationExpiryDate);
                const now = new Date();
                return now > expiry;
            }
            return false;
        })();

        // If expired or deactivated, block standard operators
        if (isExpired) {
            // Check if user is logged in and is admin
            const isUserAdmin = req.user && req.user.role === 'admin';
            if (!isUserAdmin) {
                return res.status(403).json({ 
                    message: 'Access denied. The system license has expired or is deactivated. Please contact your administrator.' 
                });
            }
        }

        next();
    } catch (err) {
        console.error('License check error:', err);
        res.status(500).json({ message: 'Internal license check validation error.' });
    }
};

/**
 * Middleware to enforce capacity limits based on the active license tier.
 */
const checkLicenseLimits = (resourceType) => {
    return async (req, res, next) => {
        try {
            // Admins can override during setup/migration, or we can enforce generally.
            // Let's enforce limits system-wide to preserve licensing models.
            const settings = await SystemSetting.findOne().lean();
            if (!settings) {
                return next();
            }

            if (resourceType === 'user') {
                const currentCount = await User.countDocuments();
                if (currentCount >= settings.maxUsers) {
                    return res.status(403).json({
                        message: `Resource limit reached. Your current license plan "${settings.licenseTier}" allows a maximum of ${settings.maxUsers} user accounts.`
                    });
                }
            } else if (resourceType === 'warehouse') {
                const currentCount = await Warehouse.countDocuments();
                if (currentCount >= settings.maxWarehouses) {
                    return res.status(403).json({
                        message: `Resource limit reached. Your current license plan "${settings.licenseTier}" allows a maximum of ${settings.maxWarehouses} location branches.`
                    });
                }
            } else if (resourceType === 'item') {
                const currentCount = await Item.countDocuments();
                if (currentCount >= settings.maxItems) {
                    return res.status(403).json({
                        message: `Resource limit reached. Your current license plan "${settings.licenseTier}" allows a maximum of ${settings.maxItems} inventory catalog items.`
                    });
                }
            }

            next();
        } catch (err) {
            console.error(`Limit check error for ${resourceType}:`, err);
            res.status(500).json({ message: 'Internal capacity check validation error.' });
        }
    };
};

module.exports = {
    checkLicenseActive,
    checkLicenseLimits
};
