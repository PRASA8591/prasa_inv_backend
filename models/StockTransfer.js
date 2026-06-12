const mongoose = require('mongoose');

const transferItemSchema = new mongoose.Schema({
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
    batchNumber: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        required: true
    },
    costPrice: {
        type: Number,
        default: 0
    },
    sellingPrice: {
        type: Number,
        default: 0
    }
});

const stockTransferSchema = new mongoose.Schema({
    transferNo: {
        type: String,
        required: true,
        unique: true
    },
    sourceWarehouse: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse',
        required: true
    },
    destinationWarehouse: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse',
        required: true
    },
    items: [transferItemSchema],
    status: {
        type: String,
        enum: ['Draft', 'Pending', 'In Transit', 'Completed', 'Cancelled'],
        default: 'Draft'
    },
    remarks: {
        type: String,
        default: ''
    },
    initiatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    receivedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    initiatedDate: {
        type: Date,
        default: Date.now
    },
    approvedDate: {
        type: Date,
        default: null
    },
    receivedDate: {
        type: Date,
        default: null
    },
    cancelledDate: {
        type: Date,
        default: null
    }
}, { timestamps: true });

module.exports = mongoose.model('StockTransfer', stockTransferSchema);
