# MED ARC Study Planner

MED ARC is a responsive study planner with notes, task conversion, a weekly calendar, and a focus timer. The browser app is served by a Node.js API and stores its shared planner state in PostgreSQL.

## Run locally with Docker

1. Install Docker Desktop.
2. Open this project folder in a terminal.
3. Run `docker compose up --build`.
4. Open [http://localhost:3000](http://localhost:3000).

The database is stored in the `med_arc_data` Docker volume and survives app restarts. Back it up before removing that volume.

## Host it

Deploy the included `Dockerfile` to a host that runs containers, and attach a PostgreSQL database. Set these environment variables on the web service:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Provided by the host (the app defaults to `3000`) |
| `DATABASE_URL` | The PostgreSQL connection string from the database provider |
| `PGSSL` | `true` when the database provider requires TLS; otherwise `false` |

Set the host's health-check path to `/health`. The app creates its small state table automatically at startup. Keep the database persistent and enable provider backups before relying on it.

## Data and privacy

The first browser that opens a fresh deployment copies its existing MED ARC browser data to the server. After that, the planner synchronizes with the server and is available across browsers. Browser storage remains as a local backup.

This version has no sign-in. The hosted planner has one shared data set, and anyone who can access its URL can view and change that data. Use a private host or add account access before putting personal or sensitive information in a public deployment.

## Local file launcher

`Launch MED ARC.bat` is the earlier desktop launcher for the browser-only version. Use Docker Compose or `npm start` with a PostgreSQL database for the full-stack version.
