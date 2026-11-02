const { Responses } = require("../responses/responses");

const hasAnyPermission = (userPermissions, required) => {
    if (!Array.isArray(userPermissions)) return false;
    return required.some((permission) => userPermissions.includes(permission));
};

const requirePermission = (permission) => (req, res, next) => {
    if (req.user?.username === "Admin") return next();

    const permissions = req.user?.permissions;
    if (Array.isArray(permissions) && permissions.includes(permission)) return next();

    const { code, message } = Responses.forbidden;
    return res.status(code).json({ code, message });
};

const requireAnyPermission = (requiredPermissions) => (req, res, next) => {
    if (req.user?.username === "Admin") return next();

    if (hasAnyPermission(req.user?.permissions, requiredPermissions)) return next();

    const { code, message } = Responses.forbidden;
    return res.status(code).json({ code, message });
};

module.exports = requirePermission;
module.exports.requireAnyPermission = requireAnyPermission;
