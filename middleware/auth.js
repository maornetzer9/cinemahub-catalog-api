require('dotenv').config();
const jwt = require('jsonwebtoken');
const { Responses, sessionResponses } = require('../responses/responses');

const authMiddleware = (req, res, next) => {
    try
    {
        const token = req.headers.authorization?.split(' ')[1];
        const { code, message } = sessionResponses.sessionExpired;

        if (!token) return res.status(code).json({ code, message });

        const verified = jwt.verify(token, process.env.SECRET_KEY);
        req.user = verified;
        next();
    }
    catch(err)
    {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            const { code, message } = sessionResponses.sessionExpired;
            return res.status(code).json({ code, message });
        }
        const { code, message } = Responses.internalError;
        console.error(err.message);
        return res.status(code).json({ code, message });
    }
};

module.exports = authMiddleware;
