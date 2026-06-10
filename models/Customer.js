const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    title: {
        type: String,
        default: 'Mr.'
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        trim: true,
        default: ''
    },
    address: {
        type: String,
        default: ''
    },
    category: {
        type: String,
        enum: ['Retail', 'Wholesale', 'VIP'],
        default: 'Retail'
    },
    type: {
        type: String,
        enum: ['Supplier', 'Seller', 'Customer'],
        default: 'Customer'
    },
    creditLimit: {
        type: Number,
        default: 0 // 0 means no credit limit allowed, positive means allowable credit
    },
    currentBalance: {
        type: Number,
        default: 0 // positive means money owed by customer (tab), negative means advance credit
    },
    loyaltyPoints: {
        type: Number,
        default: 0
    },
    loyaltyTier: {
        type: String,
        enum: ['Bronze', 'Silver', 'Gold'],
        default: 'Bronze'
    },
    walletTransactions: [{
        amount: { type: Number, required: true },
        type: { type: String, enum: ['deposit', 'payment', 'refund', 'adjustment'], required: true },
        details: { type: String },
        timestamp: { type: Date, default: Date.now }
    }],
    purchaseHistory: [{
        saleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Sale'
        },
        amount: Number,
        date: {
            type: Date,
            default: Date.now
        }
    }],
    notes: {
        type: String,
        default: ''
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    }
}, { timestamps: true });

module.exports = mongoose.model('Customer', customerSchema);
