const mongoose = require('mongoose');

const batchSchema = new mongoose.Schema({
    batchNumber: {
        type: String,
        required: true
    },
    expiryDate: {
        type: Date
    },
    costPrice: {
        type: Number,
        required: true,
        default: 0
    },
    sellingPrice: {
        type: Number,
        required: true,
        default: 0
    },
    quantity: {
        type: Number,
        required: true,
        default: 0
    },
    status: {
        type: String,
        enum: ['active', 'expired', 'quarantined'],
        default: 'active'
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse',
        default: null
    }
}, { timestamps: true });

const itemSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    sku: {
        type: String,
        required: true,
        unique: true
    },
    barcode: {
        type: String,
        trim: true,
        default: ''
    },
    description: {
        type: String
    },
    category: {
        type: String,
        required: true
    },
    subCategory: {
        type: String,
        default: ''
    },
    unitType: {
        type: String,
        enum: ['pieces', 'boxes', 'kilograms', 'liters', 'packs'],
        default: 'pieces'
    },
    taxBracket: {
        type: Number, // tax percent e.g. 18 for 18% VAT
        default: 0
    },
    movingAverageCost: {
        type: Number,
        default: 0
    },
    costPrice: {
        type: Number,
        default: 0
    },
    sellingPrice: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    // For backwards compatibility, base price and base quantity
    price: {
        type: Number,
        required: true,
        default: 0
    },
    quantity: {
        type: Number,
        required: true,
        default: 0
    },
    // Batch specific inventories
    batches: [batchSchema],
    supplier: {
        type: String
    },
    reorderPoint: {
        type: Number,
        default: 5
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, { timestamps: true });

module.exports = mongoose.model('Item', itemSchema);
