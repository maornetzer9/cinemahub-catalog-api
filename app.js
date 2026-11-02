const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const { moviesRouter } = require('./routes/movies');
const { membersRouter } = require('./routes/members');
const { errorHandler } = require('./middleware/error');

const BODY_SIZE_LIMIT = '100kb';

function corsOrigin() {
    const raw = typeof process.env.ORIGIN === 'string' ? process.env.ORIGIN.trim() : '';
    if (!raw) return undefined;
    const list = raw.split(',').map((item) => item.trim()).filter(Boolean);
    if (list.length <= 1) return list[0];
    return list;
}

function createApp() {
    const app = express();
    const corsOptions = { origin: corsOrigin() };

    app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
    app.use(express.json({ limit: BODY_SIZE_LIMIT }));
    app.use(express.urlencoded({ extended: false, limit: BODY_SIZE_LIMIT }));
    app.use(cors(corsOptions));

    app.get('/health', (_req, res) => {
        const ready = mongoose.connection.readyState === 1;
        res.status(ready ? 200 : 503).json({ ok: ready });
    });

    app.use('/movies', moviesRouter);
    app.use('/members', membersRouter);
    app.use(errorHandler);

    return app;
}

module.exports = { createApp };
