const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    username: {
        type: String,
        required: true
    },
    action: {
        type: String,
        required: true // e.g. 'PRICE_CHANGE', 'STOCK_ADJUSTMENT', 'USER_DELETED', etc.
    },
    module: {
        type: String,
        required: true // e.g. 'INVENTORY', 'PRICING', 'USERS', 'POS'
    },
    details: {
        type: String,
        required: true // Descriptive log e.g. "User X changed price of Item Y from Rs.100 to Rs.120"
    },
    ipAddress: String,
    warehouseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
