const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema({
    itemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Item',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    subtotal: {
        type: Number,
        required: true
    },
    batchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Item.batches'
    },
    batchNumber: {
        type: String
    }
});

const saleSchema = new mongoose.Schema({
    items: [saleItemSchema],
    totalAmount: {
        type: Number,
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'card', 'online', 'store_credit', 'credit_note', 'split'],
        default: 'cash'
    },
    payments: [{
        method: {
            type: String,
            enum: ['cash', 'card', 'online', 'store_credit', 'credit_note'],
            required: true
        },
        amount: {
            type: Number,
            required: true
        }
    }],
    customerName: {
        type: String,
        default: 'Walk-in Customer'
    },
    soldBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    }
}, { timestamps: true });

module.exports = mongoose.model('Sale', saleSchema);
