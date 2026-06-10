const mongoose = require('mongoose');

const grnItemSchema = new mongoose.Schema({
    itemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Item',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    batchNumber: {
        type: String,
        required: true
    },
    expiryDate: {
        type: Date,
        required: true
    },
    quantityReceived: {
        type: Number,
        required: true
    },
    costPrice: {
        type: Number,
        required: true
    },
    sellingPrice: {
        type: Number,
        required: true
    }
});

const grnSchema = new mongoose.Schema({
    grnNumber: {
        type: String,
        required: true,
        unique: true
    },
    poRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PurchaseOrder'
    },
    supplier: {
        type: String,
        required: true
    },
    items: [grnItemSchema],
    totalValue: {
        type: Number,
        required: true
    },
    receivedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receivedDate: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['draft', 'approved'],
        default: 'draft'
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    },
    notes: String
}, { timestamps: true });

module.exports = mongoose.model('GRN', grnSchema);
