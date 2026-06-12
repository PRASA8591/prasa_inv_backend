const mongoose = require('mongoose');

const systemSettingSchema = new mongoose.Schema({
    companyName: {
        type: String,
        default: 'Apex Supply Chain Inc.'
    },
    currency: {
        type: String,
        default: 'USD' // 'USD', 'EUR', 'GBP', 'LKR', etc.
    },
    currencySymbol: {
        type: String,
        default: '$' // '$', '€', '£', 'Rs.', etc.
    },
    taxRate: {
        type: Number,
        default: 8.0
    },
    address: {
        type: String,
        default: 'San Francisco, CA'
    },
    theme: {
        type: String,
        default: 'light'
    },
    glassmorphism: {
        type: Boolean,
        default: true
    },
    animations: {
        type: Boolean,
        default: true
    },
    mobile: {
        type: String,
        default: '+1 000 000 0000'
    },
    email: {
        type: String,
        default: 'contact@company.com'
    },
    shopLogo: {
        type: String,
        default: null
    },
    dailyStockUpdateEnabled: {
        type: Boolean,
        default: false
    },
    dailyStockUpdateQty: {
        type: Number,
        default: 100
    },
    dailyStockUpdateTime: {
        type: String,
        default: '00:00'
    },
    useBatchNumbers: {
        type: Boolean,
        default: true
    },
    useExpirationDates: {
        type: Boolean,
        default: true
    },
    useCostPrice: {
        type: Boolean,
        default: true
    },
    activationStatus: {
        type: String,
        enum: ['active', 'deactivated'],
        default: 'deactivated'
    },
    activationType: {
        type: String,
        enum: ['trial', 'subscription', null],
        default: null
    },
    activationStartDate: {
        type: Date,
        default: null
    },
    activationExpiryDate: {
        type: Date,
        default: null
    },
    licenseKey: {
        type: String,
        default: null
    },
    licenseTier: {
        type: String,
        default: 'Trial Mode'
    },
    licenseHolder: {
        type: String,
        default: 'Evaluation User'
    },
    maxUsers: {
        type: Number,
        default: 5
    },
    maxWarehouses: {
        type: Number,
        default: 2
    },
    maxItems: {
        type: Number,
        default: 100
    },
    activationHistory: [
        {
            licenseKey: { type: String },
            type: { type: String },
            tier: { type: String },
            duration: { type: String },
            activatedAt: { type: Date },
            expiresAt: { type: Date }
        }
    ]
}, { timestamps: true });

module.exports = mongoose.model('SystemSetting', systemSettingSchema);
