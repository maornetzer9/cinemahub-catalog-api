# CinemaHub subscriptions service

**Movies, members, and subscriptions for CinemaHub.**

Catalog records are stored in MongoDB. Sign-in and user records stay in [cinemahub-users-api](https://github.com/maornetzer9/cinemahub-users-api). This service checks the same JWT secret and reads the same user collection for token revocation and forced password changes.

The interface is [CinemaHub](https://github.com/maornetzer9/cinemahub-frontend).

## Live demo

[CinemaHub](https://cinemahub-xi3w.onrender.com) · [This API](https://movies-subscription-backend.onrender.com/health)

This service has no interface. Product screenshots are in the [frontend repository](https://github.com/maornetzer9/cinemahub-frontend).

## Responsibilities

- List, create, edit, and delete movies
- List, create, edit, and delete members
- Add a movie subscription for a member
- Enforce the permission list carried in the CinemaHub JWT
- Let an administrator token pass permission checks
- Seed an empty movie or member collection once from the configured mock URLs

## Architecture

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 or newer |
| HTTP | Express 4, Helmet, CORS |
| Data | MongoDB through Mongoose |
| Auth | JWT verified with the same secret as the user service |

```text
routes → controllers → services → models
```

Controllers pass the request through. Services own the catalog rules. Successful and business-error responses use `{ code, message, ...data }`. Authentication failures from middleware use the HTTP status directly.

## Authentication and authorization

Every catalog route expects `Authorization: Bearer <token>`.

- The token must be valid, current for `tokenVersion`, and not waiting on a password change
- Movie and member actions require the matching permission, such as `View-Movies` or `Create-Subscriptions`
- An administrator token bypasses those permission checks
- This service does not issue tokens and does not store passwords

## HTTP surface

| Method | Path | Access |
|---|---|---|
| `GET` | `/health` | Public. `{ "ok": true }` and HTTP 200 when MongoDB is connected, otherwise HTTP 503 |
| `GET` | `/movies/` | View movies, or create subscriptions |
| `POST` | `/movies/add` | Create movies |
| `PUT` | `/movies/edit` | Update movies |
| `DELETE` | `/movies/delete` | Delete movies |
| `GET` | `/members/` | View subscriptions |
| `POST` | `/members/add` | Create subscriptions |
| `PUT` | `/members/edit` | Update subscriptions |
| `POST` | `/members/new-subscription` | Create subscriptions |
| `DELETE` | `/members/delete` | Delete subscriptions |

`GET /health` does not require a token and does not return credentials or the database URI.

## MongoDB

Movies, members, and subscriptions are separate collections. A subscription stores a member id and a list of `{ movieId, date }`. Members with no subscriptions return an empty list.

The user collection is shared with the user service. This service reads `username`, `mustChangePassword`, and `tokenVersion` from it. It does not replace the full user document.

When a movie or member collection is empty, the service can load the configured mock URL once and then read MongoDB after that. Leave the mock URLs unset when the database already has data.

## Environment

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Required | Notes |
|---|---|---|
| `SECRET_KEY` | Yes | Must match the user service |
| `MONGOOSE_URI` | Yes | Same database as the user service |
| `ORIGIN` | Yes | One frontend origin, or a comma-separated list. Production includes `https://cinemahub-xi3w.onrender.com` and `https://movies-jps0.onrender.com` |
| `PORT` | No | Defaults to `3001`. Render provides this value |
| `MOCK_MOVIES_URL` | Empty database only | Used when the movies collection is empty |
| `MOCK_USERS_URL` | Empty database only | Used when the members collection is empty |

## Local development

```bash
npm install
npm run dev
```

`npm start` runs `node server.js`. `npm test` runs the Node test suite against an in-memory database. The tests do not use the database named in `.env`.

The suite covers token rejection, movie and member permissions, subscriptions, the administrator bypass, health, one-time seeding from a local mock, and shutdown.

## Deployment

The Render web service is **cinemahub-catalog-api**. Build with `npm install` and start with `npm start`. The process listens on `0.0.0.0` and the platform `PORT`. The plan is the free instance in Frankfurt.

Set `SECRET_KEY`, `MONGOOSE_URI`, `ORIGIN`, and `NODE_VERSION=20` in the Render environment. Render supplies `PORT`. Leave the mock URLs unset when the database already contains movies and members.

`GET /health` is the health check path. Use Node.js 20 or newer.

The free instance sleeps after a period without traffic. The first request after sleep waits for a new process to start. Catalog data stays in MongoDB, not on the service disk.

## Related repositories

| Service | Local URL | Repository |
|---|---|---|
| Interface | Vite dev server | [cinemahub-frontend](https://github.com/maornetzer9/cinemahub-frontend) |
| Users and authentication | `http://localhost:3000` | [cinemahub-users-api](https://github.com/maornetzer9/cinemahub-users-api) |
| This API | `http://localhost:3001` | [cinemahub-catalog-api](https://github.com/maornetzer9/cinemahub-catalog-api) |
