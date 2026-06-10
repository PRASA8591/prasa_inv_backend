const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    startTime: {
        type: Date,
        default: Date.now
    },
    endTime: {
        type: Date
    },
    startFloat: {
        type: Number,
        required: true
    },
    salesCount: {
        type: Number,
        default: 0
    },
    salesTotal: {
        type: Number,
        default: 0
    },
    expectedDrawerAmount: {
        type: Number,
        default: 0 // startFloat + cashSales
    },
    actualDrawerAmount: {
        type: Number
    },
    difference: {
        type: Number
    },
    status: {
        type: String,
        enum: ['open', 'closed'],
        default: 'open'
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    },
    notes: String
}, { timestamps: true });

module.exports = mongoose.model('Shift', shiftSchema);
