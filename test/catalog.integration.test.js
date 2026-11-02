const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const TEST_SECRET = 'phase5-subscriptions-test-secret';

function assertIsolatedUri(uri) {
    if (!uri || /mongodb\+srv|mongodb\.net|render\.com/i.test(uri)) {
        throw new Error('Refusing to run tests against a non-local database');
    }
    const host = new URL(uri).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
        throw new Error(`Refusing database host ${host}`);
    }
}

describe('subscriptions-ws integration', () => {
    let mongod;
    let server;
    let base;
    let mongoose;
    let User;
    let Movie;
    let Member;
    let Subscription;
    let jwt;
    let memoryUri;
    let seedMovieId;
    let seedMemberId;
    let createApp;
    const users = {};

    async function request(method, pathname, { body, token } = {}) {
        const response = await fetch(`${base}${pathname}`, {
            method,
            headers: {
                'content-type': 'application/json',
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }
        return { status: response.status, data };
    }

    function sign(payload, expiresIn) {
        if (expiresIn === undefined) return jwt.sign(payload, TEST_SECRET);
        return jwt.sign(payload, TEST_SECRET, { expiresIn });
    }

    before(async () => {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        mongod = await MongoMemoryServer.create();
        memoryUri = mongod.getUri();
        assertIsolatedUri(memoryUri);

        process.env.MONGOOSE_URI = memoryUri;
        process.env.SECRET_KEY = TEST_SECRET;
        process.env.ORIGIN = 'http://localhost:5173';
        process.env.MOCK_MOVIES_URL = 'http://127.0.0.1:9/movies';
        process.env.MOCK_USERS_URL = 'http://127.0.0.1:9/users';

        ({ createApp } = require('../app'));
        if (process.env.MONGOOSE_URI !== memoryUri) {
            throw new Error('Test database URI was replaced during startup');
        }
        mongoose = require('mongoose');
        User = require('../models/User');
        Movie = require('../models/Movies');
        Member = require('../models/Members');
        Subscription = require('../models/Subscriptions');
        jwt = require('jsonwebtoken');

        await mongoose.connect(memoryUri);
        assert.ok(['127.0.0.1', 'localhost'].includes(mongoose.connection.host));

        const app = createApp();
        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${server.address().port}`;

        await User.create({ username: 'Admin', mustChangePassword: false, tokenVersion: 0 });
        const viewer = await User.create({
            username: 'viewer',
            mustChangePassword: false,
            tokenVersion: 0,
        });
        const editor = await User.create({
            username: 'editor',
            mustChangePassword: false,
            tokenVersion: 0,
        });
        const locked = await User.create({
            username: 'locked',
            mustChangePassword: true,
            tokenVersion: 0,
        });
        users.viewer = String(viewer._id);
        users.editor = String(editor._id);
        users.locked = String(locked._id);

        const movie = await Movie.create({
            name: 'Seed Movie',
            genres: ['Drama'],
            image: 'http://example.test/seed.jpg',
            premiered: new Date('2020-01-01'),
        });
        seedMovieId = String(movie._id);
        const member = await Member.create({
            name: 'Seed Member',
            email: 'seed@example.test',
            city: 'Haifa',
        });
        seedMemberId = String(member._id);
    });

    after(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        if (mongoose) await mongoose.disconnect();
        if (mongod) await mongod.stop();
    });

    it('rejects a remote database uri before connecting', () => {
        assert.throws(() => assertIsolatedUri('mongodb+srv://example.mongodb.net/prod'));
    });

    it('rejects missing, invalid, and expired tokens', async () => {
        const missingMovies = await request('GET', '/movies/');
        const missingMembers = await request('GET', '/members/');
        assert.equal(missingMovies.status, 401);
        assert.equal(missingMembers.status, 401);

        const invalid = await request('GET', '/movies/', { token: 'not-a-jwt' });
        assert.equal(invalid.status, 401);
        assert.equal(invalid.data.code, 401);

        const expired = jwt.sign(
            {
                _id: users.viewer,
                permissions: ['View-Movies'],
                tokenVersion: 0,
                exp: Math.floor(Date.now() / 1000) - 10,
            },
            TEST_SECRET
        );
        const expiredResponse = await request('GET', '/movies/', { token: expired });
        assert.equal(expiredResponse.status, 401);
    });

    it('rejects a revoked or deleted user and a pending password change', async () => {
        const current = sign({
            _id: users.viewer,
            permissions: ['View-Movies'],
            tokenVersion: 0,
        });
        const allowed = await request('GET', '/movies/', { token: current });
        assert.equal(allowed.status, 200);
        assert.equal(allowed.data.code, 200);

        await User.updateOne({ _id: users.viewer }, { $inc: { tokenVersion: 1 } });
        const revoked = await request('GET', '/movies/', { token: current });
        assert.equal(revoked.status, 401);
        assert.equal(revoked.data.code, 401);

        const refreshed = sign({
            _id: users.viewer,
            permissions: ['View-Movies'],
            tokenVersion: 1,
        });
        const afterRefresh = await request('GET', '/movies/', { token: refreshed });
        assert.equal(afterRefresh.data.code, 200);

        const legacy = sign({ _id: users.editor, permissions: ['View-Movies'] });
        const legacyResponse = await request('GET', '/movies/', { token: legacy });
        assert.equal(legacyResponse.status, 401);

        const pending = sign({
            _id: users.locked,
            permissions: ['View-Movies'],
            tokenVersion: 0,
        });
        const passwordChange = await request('GET', '/movies/', { token: pending });
        assert.equal(passwordChange.status, 403);
        assert.equal(passwordChange.data.code, 403);

        await User.deleteOne({ _id: users.editor });
        const deleted = sign({
            _id: users.editor,
            permissions: ['View-Movies'],
            tokenVersion: 0,
        });
        const deletedResponse = await request('GET', '/movies/', { token: deleted });
        assert.equal(deletedResponse.status, 401);
    });

    it('enforces movie permissions and persists create, update, and delete', async () => {
        const viewToken = sign({
            _id: users.viewer,
            permissions: ['View-Movies'],
            tokenVersion: 1,
        });
        const editToken = sign({
            _id: users.viewer,
            permissions: ['View-Movies', 'Create-Movies', 'Update-Movies', 'Delete-Movies'],
            tokenVersion: 1,
        });

        const forbidden = await request('POST', '/movies/add', {
            token: viewToken,
            body: {
                name: 'Blocked Movie',
                genres: ['Test'],
                image: 'http://example.test/blocked.jpg',
                premiered: '2024-01-01',
            },
        });
        assert.equal(forbidden.status, 403);
        assert.equal(await Movie.findOne({ name: 'Blocked Movie' }), null);

        const created = await request('POST', '/movies/add', {
            token: editToken,
            body: {
                name: 'Added Movie',
                genres: ['Action'],
                image: 'http://example.test/added.jpg',
                premiered: '2024-02-02',
            },
        });
        assert.equal(created.status, 200);
        assert.equal(created.data.code, 200);
        const createdId = String(created.data.movie._id);
        const stored = await Movie.findById(createdId);
        assert.equal(stored.name, 'Added Movie');
        assert.equal(await Movie.findOne({ name: 'Seed Movie' }) !== null, true);

        const invalid = await request('POST', '/movies/add', {
            token: editToken,
            body: { name: 'Incomplete Movie' },
        });
        assert.equal(invalid.data.code, 500);
        assert.equal(await Movie.findOne({ name: 'Incomplete Movie' }), null);

        const updated = await request('PUT', '/movies/edit', {
            token: editToken,
            body: {
                _id: createdId,
                name: 'Renamed Movie',
                genres: ['Action'],
                image: 'http://example.test/added.jpg',
                premiered: '2024-02-02',
            },
        });
        assert.equal(updated.data.code, 200);
        assert.equal((await Movie.findById(createdId)).name, 'Renamed Movie');

        const removed = await request('DELETE', `/movies/delete?_id=${createdId}`, { token: editToken });
        assert.equal(removed.data.code, 200);
        assert.equal(await Movie.findById(createdId), null);
        assert.equal((await Movie.findById(seedMovieId)).name, 'Seed Movie');

        const listed = await request('GET', '/movies/', { token: viewToken });
        assert.equal(listed.data.code, 200);
        assert.equal(listed.data.movies.some((movie) => movie.name === 'Seed Movie'), true);
        assert.equal(listed.data.movies.some((movie) => movie.name === 'Renamed Movie'), false);
    });

    it('enforces member and subscription permissions and persists each write', async () => {
        const viewToken = sign({
            _id: users.viewer,
            permissions: ['View-Subscriptions'],
            tokenVersion: 1,
        });
        const editToken = sign({
            _id: users.viewer,
            permissions: ['View-Subscriptions', 'Create-Subscriptions', 'Update-Subscriptions', 'Delete-Subscriptions'],
            tokenVersion: 1,
        });

        const forbidden = await request('POST', '/members/add', {
            token: viewToken,
            body: { name: 'Blocked Member', email: 'blocked@example.test', city: 'Tel Aviv' },
        });
        assert.equal(forbidden.status, 403);
        assert.equal(await Member.findOne({ email: 'blocked@example.test' }), null);

        const created = await request('POST', '/members/add', {
            token: editToken,
            body: { name: 'Added Member', email: 'added@example.test', city: 'Jerusalem' },
        });
        assert.equal(created.data.code, 200);
        const memberId = String(created.data.member._id);
        assert.equal((await Member.findById(memberId)).city, 'Jerusalem');

        const updated = await request('PUT', '/members/edit', {
            token: editToken,
            body: { _id: memberId, name: 'Added Member', email: 'added@example.test', city: 'Eilat' },
        });
        assert.equal(updated.data.code, 200);
        assert.equal((await Member.findById(memberId)).city, 'Eilat');
        assert.equal((await Member.findById(seedMemberId)).city, 'Haifa');

        const subscribed = await request('POST', '/members/new-subscription', {
            token: editToken,
            body: { memberId, movieId: seedMovieId, date: '2024-03-03' },
        });
        assert.equal(subscribed.data.code, 200);
        const subscription = await Subscription.findOne({ memberId });
        assert.equal(subscription.movies.length, 1);
        assert.equal(String(subscription.movies[0].movieId), seedMovieId);

        const removed = await request('DELETE', `/members/delete?id=${memberId}`, { token: editToken });
        assert.equal(removed.data.code, 200);
        assert.equal(await Member.findById(memberId), null);
        assert.equal(await Subscription.findOne({ memberId }), null);
        assert.equal((await Member.findById(seedMemberId)).name, 'Seed Member');

        const listed = await request('GET', '/members/', { token: viewToken });
        assert.equal(listed.data.code, 200);
        assert.equal(listed.data.members.some((member) => member.name === 'Seed Member'), true);
        assert.equal(listed.data.members.some((member) => member.email === 'added@example.test'), false);
    });

    it('lets an admin token bypass permission checks', async () => {
        const admin = sign({ username: 'Admin', tokenVersion: 0 });
        const created = await request('POST', '/movies/add', {
            token: admin,
            body: {
                name: 'Admin Movie',
                genres: ['Admin'],
                image: 'http://example.test/admin.jpg',
                premiered: '2024-04-04',
            },
        });
        assert.equal(created.data.code, 200);
        assert.equal((await Movie.findOne({ name: 'Admin Movie' })).name, 'Admin Movie');
    });

    it('reports health without authentication and without sensitive fields', async () => {
        const health = await request('GET', '/health');
        assert.equal(health.status, 200);
        assert.deepEqual(health.data, { ok: true });
        assert.doesNotMatch(JSON.stringify(health.data), /mongodb|password|secret|credential|uri/i);

        const movies = await request('GET', '/movies/');
        assert.equal(movies.status, 401);

        await mongoose.disconnect();
        const unavailable = await request('GET', '/health');
        assert.equal(unavailable.status, 503);
        assert.deepEqual(unavailable.data, { ok: false });
        await mongoose.connect(memoryUri);
        assert.ok(['127.0.0.1', 'localhost'].includes(mongoose.connection.host));
        const restored = await request('GET', '/health');
        assert.equal(restored.status, 200);
        assert.deepEqual(restored.data, { ok: true });
    });

    it('keeps catalog records after the memory database reconnects', async () => {
        await mongoose.disconnect();
        await mongoose.connect(memoryUri);
        assert.ok(['127.0.0.1', 'localhost'].includes(mongoose.connection.host));
        assert.equal((await Movie.findById(seedMovieId)).name, 'Seed Movie');
        assert.equal((await Member.findById(seedMemberId)).name, 'Seed Member');
    });

    async function stopIsolatedServer(signal) {
        const port = await new Promise((resolve, reject) => {
            const probe = net.createServer();
            probe.listen(0, '127.0.0.1', () => {
                const reserved = probe.address().port;
                probe.close((err) => (err ? reject(err) : resolve(reserved)));
            });
        });
        const child = spawn(process.execPath, ['server.js'], {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                PORT: String(port),
                MONGOOSE_URI: memoryUri,
                SECRET_KEY: TEST_SECRET,
                ORIGIN: 'http://localhost:5173',
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });

        try {
            const started = Date.now();
            while (!output.includes(`Server is running on PORT: ${port}`)) {
                if (child.exitCode !== null) throw new Error(output.slice(-800));
                if (Date.now() - started > 20000) throw new Error(`startup timeout: ${output.slice(-800)}`);
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            assert.doesNotMatch(output, /mongodb\+srv|mongodb\.net/i);
            const health = await fetch(`http://127.0.0.1:${port}/health`);
            const body = await health.json();
            assert.equal(health.status, 200);
            assert.deepEqual(body, { ok: true });
            const movies = await fetch(`http://127.0.0.1:${port}/movies/`);
            assert.equal(movies.status, 401);

            child.send(signal);
            const exitCode = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    child.kill('SIGKILL');
                    reject(new Error(`${signal} shutdown timed out: ${output.slice(-800)}`));
                }, 15000);
                child.once('exit', (code) => {
                    clearTimeout(timer);
                    resolve(code);
                });
            });
            assert.equal(exitCode, 0);
            assert.match(output, /Shutting down/);
            await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
            assert.doesNotMatch(output, /mongodb\+srv|mongodb\.net/i);
        } finally {
            if (child.exitCode === null) child.kill('SIGKILL');
        }
    }

    it('hides internal failures and keeps validation messages', async () => {
        const editToken = sign({
            _id: users.viewer,
            permissions: ['View-Movies', 'Create-Movies', 'Update-Movies', 'Delete-Movies', 'View-Subscriptions', 'Create-Subscriptions', 'Delete-Subscriptions'],
            tokenVersion: 1,
        });
        const viewToken = sign({
            _id: users.viewer,
            permissions: ['View-Movies'],
            tokenVersion: 1,
        });

        const forbidden = await request('POST', '/movies/add', {
            token: viewToken,
            body: {
                name: 'Still Blocked',
                genres: ['Test'],
                image: 'http://example.test/blocked.jpg',
                premiered: '2024-01-01',
            },
        });
        assert.equal(forbidden.status, 403);
        assert.deepEqual(forbidden.data, { code: 403, message: 'Forbidden' });

        const duplicate = await request('POST', '/members/add', {
            token: editToken,
            body: { name: 'Another Member', email: 'seed@example.test', city: 'Haifa' },
        });
        assert.equal(duplicate.status, 200);
        assert.equal(duplicate.data.code, 1);
        assert.equal(duplicate.data.message, 'This member is already exists');
        assert.equal(await Member.countDocuments({ email: 'seed@example.test' }), 1);

        const invalidMovie = await request('POST', '/movies/add', {
            token: editToken,
            body: { name: 'Missing Fields' },
        });
        assert.equal(invalidMovie.status, 200);
        assert.deepEqual(invalidMovie.data, { code: 500, message: 'Internal Server Error' });
        assert.equal(await Movie.findOne({ name: 'Missing Fields' }), null);

        const badMovieId = await request('DELETE', '/movies/delete?_id=not-an-id', { token: editToken });
        assert.equal(badMovieId.status, 200);
        assert.deepEqual(badMovieId.data, { code: 1, message: 'Cannot delete movie' });
        assert.equal((await Movie.findById(seedMovieId)).name, 'Seed Movie');

        const badMemberId = await request('DELETE', '/members/delete?id=not-an-id', { token: editToken });
        assert.equal(badMemberId.status, 200);
        assert.deepEqual(badMemberId.data, { code: 4, message: 'This member is not deleted' });
        assert.equal((await Member.findById(seedMemberId)).name, 'Seed Member');

        const malformed = await fetch(`${base}/movies/add`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${editToken}`,
            },
            body: '{',
        });
        assert.equal(malformed.status, 500);
        assert.deepEqual(await malformed.json(), { code: 500, message: 'Internal Server Error' });

        await mongoose.disconnect();
        const databaseDown = await request('GET', '/movies/', { token: viewToken });
        assert.equal(databaseDown.status, 500);
        assert.deepEqual(databaseDown.data, { code: 500, message: 'Internal Server Error' });
        await mongoose.connect(memoryUri);
        assert.ok(['127.0.0.1', 'localhost'].includes(mongoose.connection.host));

        const restored = await request('GET', '/movies/', { token: viewToken });
        assert.equal(restored.status, 200);
        assert.equal(restored.data.code, 200);
        assert.equal(restored.data.movies.some((movie) => movie.name === 'Seed Movie'), true);
    });

    it('rejects malformed catalog ids and still updates a real movie', async () => {
        const token = sign({
            _id: users.viewer,
            permissions: ['View-Movies', 'Create-Movies', 'Update-Movies', 'Delete-Movies', 'View-Subscriptions', 'Create-Subscriptions', 'Update-Subscriptions', 'Delete-Subscriptions'],
            tokenVersion: 1,
        });
        const movieCount = await Movie.countDocuments();
        const memberCount = await Member.countDocuments();
        const subscriptionCount = await Subscription.countDocuments();

        const movieCases = [
            ['DELETE', '/movies/delete?_id=', null],
            ['DELETE', '/movies/delete?_id[$ne]=', null],
            ['DELETE', `/movies/delete?_id=${seedMovieId}&_id=second`, null],
            ['PUT', '/movies/edit', { _id: '', name: 'Hijacked', genres: ['X'], image: 'http://example.test/x.jpg', premiered: '2024-01-01' }],
            ['PUT', '/movies/edit', { _id: null, name: 'Hijacked', genres: ['X'], image: 'http://example.test/x.jpg', premiered: '2024-01-01' }],
            ['PUT', '/movies/edit', { _id: { $regex: '.*' }, name: 'Hijacked', genres: ['X'], image: 'http://example.test/x.jpg', premiered: '2024-01-01' }],
            ['PUT', '/movies/edit', { _id: [seedMovieId], name: 'Hijacked', genres: ['X'], image: 'http://example.test/x.jpg', premiered: '2024-01-01' }],
            ['PUT', '/movies/edit', { _id: 12345, name: 'Hijacked', genres: ['X'], image: 'http://example.test/x.jpg', premiered: '2024-01-01' }],
        ];
        for (const [method, pathname, body] of movieCases) {
            const response = await request(method, pathname, body === null ? { token } : { token, body });
            assert.equal(response.status, 200);
            assert.notEqual(response.data.code, 200);
            assert.doesNotMatch(JSON.stringify(response.data), /\$ne|\$regex|cast|mongodb|stack/i);
        }

        const memberCases = [
            ['DELETE', '/members/delete?id=', null],
            ['DELETE', '/members/delete?id[$gt]=', null],
            ['PUT', '/members/edit', { _id: { $ne: null }, name: 'Hijacked', email: 'hijack@example.test', city: 'Nowhere' }],
            ['POST', '/members/new-subscription', { memberId: { $ne: null }, movieId: seedMovieId, date: '2024-05-05' }],
            ['POST', '/members/new-subscription', { memberId: seedMemberId, movieId: { $gt: '' }, date: '2024-05-05' }],
            ['POST', '/members/new-subscription', { memberId: '', movieId: '', date: '2024-05-05' }],
        ];
        for (const [method, pathname, body] of memberCases) {
            const response = await request(method, pathname, body === null ? { token } : { token, body });
            assert.equal(response.status, 200);
            assert.notEqual(response.data.code, 200);
            assert.doesNotMatch(JSON.stringify(response.data), /\$ne|\$gt|cast|mongodb|stack/i);
        }

        assert.equal(await Movie.countDocuments(), movieCount);
        assert.equal(await Member.countDocuments(), memberCount);
        assert.equal(await Subscription.countDocuments(), subscriptionCount);
        assert.equal((await Movie.findById(seedMovieId)).name, 'Seed Movie');
        assert.equal((await Member.findById(seedMemberId)).name, 'Seed Member');

        const renamed = await request('PUT', '/movies/edit', {
            token,
            body: {
                _id: seedMovieId,
                name: 'Seed Movie',
                genres: ['Drama'],
                image: 'http://example.test/seed.jpg',
                premiered: '2020-01-01',
            },
        });
        assert.equal(renamed.status, 200);
        assert.equal(renamed.data.code, 200);
        assert.equal(renamed.data.movie.name, 'Seed Movie');

        const subscribed = await request('POST', '/members/new-subscription', {
            token,
            body: { memberId: seedMemberId, movieId: seedMovieId, date: '2024-06-06' },
        });
        assert.equal(subscribed.status, 200);
        assert.equal(subscribed.data.code, 200);
        assert.equal(subscribed.data.member._id, seedMemberId);
        assert.equal(subscribed.data.member.subscriptions.some((row) => row.movieId === seedMovieId), true);
    });

    it('seeds an empty catalog from a local mock server once', async () => {
        const previousMoviesUrl = process.env.MOCK_MOVIES_URL;
        const previousUsersUrl = process.env.MOCK_USERS_URL;
        const hits = { movies: 0, users: 0 };
        const mock = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (url.pathname === '/movies') {
                hits.movies += 1;
                res.writeHead(302, { Location: '/movies-body' });
                res.end();
                return;
            }
            if (url.pathname === '/movies-body') {
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify([{
                    name: 'Local Mock Movie',
                    genres: ['Local'],
                    image: { original: 'http://127.0.0.1/local-mock.jpg' },
                    premiered: '2021-02-02',
                }]));
                return;
            }
            if (url.pathname === '/users') {
                hits.users += 1;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify([{
                    name: 'Local Mock Member',
                    email: 'local-mock@example.test',
                    address: { city: 'Local City' },
                }]));
                return;
            }
            res.statusCode = 404;
            res.end();
        });

        await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
        const mockBase = `http://127.0.0.1:${mock.address().port}`;
        const token = sign({
            _id: users.viewer,
            permissions: ['View-Movies', 'View-Subscriptions'],
            tokenVersion: 1,
        });

        try {
            await Subscription.deleteMany({});
            await Movie.deleteMany({});
            await Member.deleteMany({});
            process.env.MOCK_MOVIES_URL = `${mockBase}/movies`;
            process.env.MOCK_USERS_URL = `${mockBase}/users`;

            const seededMovies = await request('GET', '/movies/', { token });
            assert.equal(seededMovies.status, 200);
            assert.equal(seededMovies.data.code, 200);
            assert.equal(seededMovies.data.movies.length, 1);
            assert.equal(seededMovies.data.movies[0].name, 'Local Mock Movie');
            assert.equal(seededMovies.data.movies[0].image, 'http://127.0.0.1/local-mock.jpg');

            const seededMembers = await request('GET', '/members/', { token });
            assert.equal(seededMembers.status, 200);
            assert.equal(seededMembers.data.code, 200);
            assert.equal(seededMembers.data.members.length, 1);
            assert.equal(seededMembers.data.members[0].name, 'Local Mock Member');
            assert.equal(seededMembers.data.members[0].city, 'Local City');
            assert.deepEqual(seededMembers.data.members[0].subscriptions, []);

            const repeatMovies = await request('GET', '/movies/', { token });
            const repeatMembers = await request('GET', '/members/', { token });
            assert.equal(repeatMovies.data.code, 200);
            assert.equal(repeatMovies.data.movies.length, 1);
            assert.equal(repeatMembers.data.code, 200);
            assert.equal(repeatMembers.data.members.length, 1);
            assert.equal(hits.movies, 1);
            assert.equal(hits.users, 1);
        } finally {
            process.env.MOCK_MOVIES_URL = previousMoviesUrl;
            process.env.MOCK_USERS_URL = previousUsersUrl;
            await new Promise((resolve) => mock.close(resolve));
            await Subscription.deleteMany({});
            await Movie.deleteMany({});
            await Member.deleteMany({});
            const movie = await Movie.create({
                name: 'Seed Movie',
                genres: ['Drama'],
                image: 'http://example.test/seed.jpg',
                premiered: new Date('2020-01-01'),
            });
            seedMovieId = String(movie._id);
            const member = await Member.create({
                name: 'Seed Member',
                email: 'seed@example.test',
                city: 'Haifa',
            });
            seedMemberId = String(member._id);
        }
    });

    it('rejects operator payloads for movie and member names', async () => {
        const token = sign({
            _id: users.viewer,
            permissions: [
                'View-Movies',
                'Create-Movies',
                'Update-Movies',
                'Delete-Movies',
                'View-Subscriptions',
                'Create-Subscriptions',
                'Update-Subscriptions',
                'Delete-Subscriptions',
            ],
            tokenVersion: 1,
        });
        const shapes = [
            { $ne: null },
            { $gt: '' },
            { $regex: '.*' },
            ['Seed Movie'],
            null,
            7,
            { nested: { $gt: '' } },
        ];
        const movieCount = await Movie.countDocuments();
        const memberCount = await Member.countDocuments();

        for (const name of shapes) {
            const createdMovie = await request('POST', '/movies/add', {
                token,
                body: {
                    name,
                    genres: ['Test'],
                    image: 'http://example.test/operator.jpg',
                    premiered: '2024-01-01',
                },
            });
            assert.equal(createdMovie.status, 200);
            assert.equal(createdMovie.data.code, 400);

            const editedMovie = await request('PUT', '/movies/edit', {
                token,
                body: {
                    _id: seedMovieId,
                    name,
                    genres: ['Drama'],
                    image: 'http://example.test/seed.jpg',
                    premiered: '2020-01-01',
                },
            });
            assert.equal(editedMovie.status, 200);
            assert.equal(editedMovie.data.code, 400);

            const createdMember = await request('POST', '/members/add', {
                token,
                body: { name, email: 'operator@example.test', city: 'Haifa' },
            });
            assert.equal(createdMember.status, 200);
            assert.equal(createdMember.data.code, 400);

            const createdByEmail = await request('POST', '/members/add', {
                token,
                body: { name: 'Operator Member', email: name, city: 'Haifa' },
            });
            assert.equal(createdByEmail.status, 200);
            assert.equal(createdByEmail.data.code, 400);

            const editedMember = await request('PUT', '/members/edit', {
                token,
                body: { _id: seedMemberId, name, email: 'seed@example.test', city: 'Haifa' },
            });
            assert.equal(editedMember.status, 200);
            assert.equal(editedMember.data.code, 400);
        }

        assert.equal(await Movie.countDocuments(), movieCount);
        assert.equal(await Member.countDocuments(), memberCount);
        assert.equal((await Movie.findById(seedMovieId)).name, 'Seed Movie');
        assert.equal((await Member.findById(seedMemberId)).name, 'Seed Member');
        assert.equal((await Member.findById(seedMemberId)).email, 'seed@example.test');
        assert.equal(await Member.countDocuments({ email: 'seed@example.test' }), 1);

        const created = await request('POST', '/movies/add', {
            token,
            body: {
                name: 'Operator Safe Movie',
                genres: ['Safe'],
                image: 'http://example.test/safe.jpg',
                premiered: '2024-07-07',
            },
        });
        assert.equal(created.data.code, 200);
        assert.equal(created.data.movie.name, 'Operator Safe Movie');
        const member = await request('POST', '/members/add', {
            token,
            body: { name: 'Operator Safe Member', email: 'safe-member@example.test', city: 'Haifa' },
        });
        assert.equal(member.data.code, 200);
        assert.equal(member.data.member.email, 'safe-member@example.test');
        const removedMovie = await request('DELETE', `/movies/delete?_id=${created.data.movie._id}`, { token });
        const removedMember = await request('DELETE', `/members/delete?id=${member.data.member._id}`, { token });
        assert.equal(removedMovie.data.code, 200);
        assert.equal(removedMember.data.code, 200);
        assert.equal(await Movie.findOne({ name: 'Operator Safe Movie' }), null);
        assert.equal((await Movie.findById(seedMovieId)).name, 'Seed Movie');
    });

    it('shuts down on SIGTERM and closes the listener', async () => {
        await stopIsolatedServer('SIGTERM');
    });

    it('shuts down on SIGINT and closes the listener', async () => {
        await stopIsolatedServer('SIGINT');
    });
});
