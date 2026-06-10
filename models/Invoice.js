const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema({
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
    costPrice: {
        type: Number,
        default: 0
    },
    sellingPrice: {
        type: Number,
        default: 0
    },
    batchNumber: {
        type: String,
        default: ''
    },
    expiryDate: {
        type: Date
    },
    taxRate: {
        type: Number,
        default: 0
    },
    subtotal: {
        type: Number,
        required: true
    }
});

const invoiceSchema = new mongoose.Schema({
    invoiceNumber: {
        type: String,
        required: true,
        unique: true
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer'
    },
    customerDetails: {
        name: String,
        email: String,
        phone: String,
        address: String
    },
    items: [invoiceItemSchema],
    subtotal: {
        type: Number,
        required: true
    },
    taxTotal: {
        type: Number,
        required: true
    },
    discountTotal: {
        type: Number,
        default: 0
    },
    grandTotal: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled', 'completed'],
        default: 'draft'
    },
    paymentTerms: {
        type: String, // e.g., Net 15, Net 30, Due on receipt
        default: 'Due on receipt'
    },
    dueDate: {
        type: Date,
        required: true
    },
    invoiceDate: {
        type: Date,
        default: Date.now
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    },
    notes: String
}, { timestamps: true });

module.exports = mongoose.model('Invoice', invoiceSchema);
