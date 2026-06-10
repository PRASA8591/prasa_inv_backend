const mongoose = require('mongoose');

const poItemSchema = new mongoose.Schema({
    itemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Item',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    sku: {
        type: String,
        required: true
    },
    quantityOrdered: {
        type: Number,
        required: true
    },
    estimatedCost: {
        type: Number,
        required: true
    },
    quantityReceived: {
        type: Number,
        default: 0
    }
});

const poSchema = new mongoose.Schema({
    poNumber: {
        type: String,
        required: true,
        unique: true
    },
    supplier: {
        type: String,
        required: true
    },
    items: [poItemSchema],
    totalAmount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['draft', 'pending_approval', 'approved', 'sent', 'received', 'cancelled'],
        default: 'draft'
    },
    expectedDeliveryDate: {
        type: Date
    },
    orderedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    },
    notes: String
}, { timestamps: true });

module.exports = mongoose.model('PurchaseOrder', poSchema);
