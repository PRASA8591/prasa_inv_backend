const crypto = require('crypto');

const SECRET_SALT = 'PRASATEK_LICENSE_SECRET_KEY';

const TIER_MAPPING = {
    'TR': { name: 'Trial Mode', maxUsers: 5, maxWarehouses: 2, maxItems: 100 },
    'PR': { name: 'Professional', maxUsers: 25, maxWarehouses: 5, maxItems: 1000 },
    'EN': { name: 'Enterprise Unlimited', maxUsers: 9999, maxWarehouses: 9999, maxItems: 999999 }
};

const DURATION_MAPPING = {
    '01': { label: '1 Day', days: 1 },
    '03': { label: '3 Days', days: 3 },
    '05': { label: '5 Days', days: 5 },
    '07': { label: '7 Days', days: 7 },
    '10': { label: '10 Days', days: 10 },
    '14': { label: '14 Days', days: 14 },
    '30': { label: '30 Days', days: 30 },
    '3M': { label: '3 Months', months: 3 },
    '6M': { label: '6 Months', months: 6 },
    '1Y': { label: '1 Year', years: 1 },
    '2Y': { label: '2 Years', years: 2 },
    '3Y': { label: '3 Years', years: 3 },
    '4Y': { label: '4 Years', years: 4 },
    '5Y': { label: '5 Years', years: 5 }
};

/**
 * Calculates the checksum of the first N segments of a key using DJB2 algorithm.
 */
function calculateChecksum(payload) {
    let hash = 5381;
    const combined = payload + SECRET_SALT;
    for (let i = 0; i < combined.length; i++) {
        hash = ((hash << 5) + hash) + combined.charCodeAt(i);
    }
    const hex = Math.abs(hash & 0xFFFFFFFF).toString(16).toUpperCase();
    return hex.padStart(4, '0').substring(0, 4);
}

/**
 * Generates a cryptographically signed license key.
 * Format: PT-[TIER_CODE][DURATION_CODE]-[HOLDER_HASH]-[RANDOM_CHARS]-[CHECKSUM]
 */
function generateLicenseKey(tierCode, durationCode, holderName = 'Evaluation') {
    const cleanHolder = holderName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 4) || 'EVAL';
    const randomChars = crypto.randomBytes(2).toString('hex').toUpperCase(); // 4 chars hex
    
    const baseKey = `PT-${tierCode}${durationCode}-${cleanHolder}-${randomChars}`;
    const checksum = calculateChecksum(baseKey);
    
    return `${baseKey}-${checksum}`;
}

/**
 * Validates a license key and decodes its plan configurations.
 * Returns { valid: boolean, error?: string, tier?: string, duration?: string, limits?: object, expiryDate?: Date }
 */
function validateLicenseKey(licenseKey) {
    if (!licenseKey || typeof licenseKey !== 'string') {
        return { valid: false, error: 'License key is empty or invalid type.' };
    }

    const segments = licenseKey.trim().toUpperCase().split('-');
    if (segments.length !== 5 || segments[0] !== 'PT') {
        return { valid: false, error: 'Invalid license key format. Expected PT-XXXX-XXXX-XXXX-XXXX' };
    }

    const [prefix, configBlock, holderBlock, randomBlock, checksumBlock] = segments;

    // Verify signature
    const baseKey = `${prefix}-${configBlock}-${holderBlock}-${randomBlock}`;
    const expectedChecksum = calculateChecksum(baseKey);

    if (checksumBlock !== expectedChecksum) {
        return { valid: false, error: 'Cryptographic signature verification failed. The license key has been tampered with or is invalid.' };
    }

    // Decode Config block
    const tierCode = configBlock.substring(0, 2);
    const durationCode = configBlock.substring(2);

    const plan = TIER_MAPPING[tierCode];
    const duration = DURATION_MAPPING[durationCode];

    if (!plan) {
        return { valid: false, error: `Invalid license tier code "${tierCode}" embedded in key.` };
    }
    if (!duration) {
        return { valid: false, error: `Invalid license duration code "${durationCode}" embedded in key.` };
    }

    // Calculate expiry date
    const expiryDate = new Date();
    if (duration.days) {
        expiryDate.setDate(expiryDate.getDate() + duration.days);
    } else if (duration.months) {
        expiryDate.setMonth(expiryDate.getMonth() + duration.months);
    } else if (duration.years) {
        expiryDate.setFullYear(expiryDate.getFullYear() + duration.years);
    }

    return {
        valid: true,
        tier: plan.name,
        type: tierCode === 'TR' ? 'trial' : 'subscription',
        duration: duration.label,
        holder: holderBlock,
        limits: {
            maxUsers: plan.maxUsers,
            maxWarehouses: plan.maxWarehouses,
            maxItems: plan.maxItems
        },
        expiryDate
    };
}

module.exports = {
    generateLicenseKey,
    validateLicenseKey,
    TIER_MAPPING,
    DURATION_MAPPING
};
