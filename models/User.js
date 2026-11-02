const mongoose = require("mongoose");

const usersSchema = new mongoose.Schema(
    {
        username: { type: String },
        mustChangePassword: { type: Boolean, default: false },
        tokenVersion: { type: Number, default: 0 },
    },
    { collection: "users" }
);

module.exports = mongoose.models.users || mongoose.model("users", usersSchema);
