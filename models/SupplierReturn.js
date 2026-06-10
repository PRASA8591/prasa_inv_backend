const mongoose = require('mongoose');

const returnItemSchema = new mongoose.Schema({
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
    quantityReturned: {
        type: Number,
        required: true
    },
    unitCost: {
        type: Number,
        required: true
    }
});

const supplierReturnSchema = new mongoose.Schema({
    returnNumber: {
        type: String,
        required: true,
        unique: true
    },
    grnRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GRN'
    },
    supplier: {
        type: String,
        required: true
    },
    items: [returnItemSchema],
    totalValue: {
        type: Number,
        required: true
    },
    returnedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    returnDate: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['draft', 'completed'],
        default: 'draft'
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    },
    reason: String,
    notes: String
}, { timestamps: true });

module.exports = mongoose.model('SupplierReturn', supplierReturnSchema);
