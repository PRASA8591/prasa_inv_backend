const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['admin', 'manager', 'user'],
        default: 'user'
    },
    access: {
        dashboard: { type: Boolean, default: true },
        dashboard_edit: { type: Boolean, default: true },
        items: { type: Boolean, default: true },
        items_edit: { type: Boolean, default: true },
        stock: { type: Boolean, default: true },
        stock_edit: { type: Boolean, default: true },
        direct_stock: { type: Boolean, default: true },
        direct_stock_edit: { type: Boolean, default: true },
        pos: { type: Boolean, default: true },
        pos_edit: { type: Boolean, default: true },
        price: { type: Boolean, default: true },
        price_edit: { type: Boolean, default: true },
        crm: { type: Boolean, default: false },
        crm_edit: { type: Boolean, default: false },
        supply: { type: Boolean, default: false },
        supply_edit: { type: Boolean, default: false },
        invoices: { type: Boolean, default: false },
        invoices_edit: { type: Boolean, default: false },
        users: { type: Boolean, default: false },
        users_edit: { type: Boolean, default: false },
        reports: { type: Boolean, default: true },
        reports_edit: { type: Boolean, default: true },
        locations: { type: Boolean, default: false },
        locations_edit: { type: Boolean, default: false },
        settings: { type: Boolean, default: false },
        settings_edit: { type: Boolean, default: false },
        approvals: { type: Boolean, default: false },
        approvals_edit: { type: Boolean, default: false },
        recent_bills: { type: Boolean, default: false },
        recent_bills_edit: { type: Boolean, default: false },
        audit_logs: { type: Boolean, default: false },
        audit_logs_edit: { type: Boolean, default: false }
    },
    allowedWarehouses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    }],
    currentWarehouse: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
