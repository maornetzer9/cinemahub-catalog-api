require('dotenv').config();
const { validateEnv } = require('./config/validateEnv');
const { validateCorsOrigin } = require('./config/validateCors');
const mongooseSession = require('./config/db');
const { closeDataConnections } = mongooseSession;
const { createApp } = require('./app');

validateEnv();
validateCorsOrigin();

const app = createApp();
const PORT = process.env.PORT || 3001;
const SHUTDOWN_TIMEOUT_MS = 10000;

function listenAndShutdown() {
    const server = app.listen(PORT, '0.0.0.0', () => console.info(`Server is running on PORT: ${PORT}`));
    let shuttingDown = false;

    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        process.stdout.write('Shutting down\n');

        const timer = setTimeout(() => {
            console.error('Graceful shutdown timed out');
            process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);

        server.close((closeErr) => {
            closeDataConnections()
                .then(() => {
                    clearTimeout(timer);
                    if (closeErr) {
                        process.stderr.write(`Failed to close the HTTP server: ${closeErr.code || 'error'}\n`);
                        process.exit(1);
                    }
                    if (process.channel) process.disconnect();
                    const leftover = setTimeout(() => {
                        process.stderr.write('Open handles remained after shutdown\n');
                        process.exit(1);
                    }, 500);
                    leftover.unref();
                })
                .catch((err) => {
                    clearTimeout(timer);
                    process.stderr.write(`Failed to close database connections: ${err && err.name ? err.name : 'error'}\n`);
                    process.exit(1);
                });
        });

        if (typeof server.closeIdleConnections === 'function') {
            server.closeIdleConnections();
        }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    if (process.channel) {
        process.on('message', (message) => {
            if (message === 'SIGTERM' || message === 'SIGINT') process.emit(message);
        });
    }
}

if (require.main === module) {
    mongooseSession((err) => {
        if (err) {
            console.error('Failed to connect to MongoDB:', err.message);
            process.exit(1);
        }

        listenAndShutdown();
    });
}

module.exports = { app };
