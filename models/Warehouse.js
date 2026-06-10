const mongoose = require('mongoose');

const warehouseSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    address: {
        type: String,
        default: ''
    },
    phone: {
        type: String,
        default: ''
    },
    email: {
        type: String,
        default: ''
    },
    type: {
        type: String,
        enum: ['Warehouse', 'Retail Store', 'Distribution Center'],
        default: 'Warehouse'
    },
    manager: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    allowedPages: {
        type: [String],
        default: ['dashboard', 'items', 'stock', 'direct_stock', 'pos', 'price', 'crm', 'supply', 'invoices', 'users', 'reports', 'settings']
    },
    isMain: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

module.exports = mongoose.model('Warehouse', warehouseSchema);
