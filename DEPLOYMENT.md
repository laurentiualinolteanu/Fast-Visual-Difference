# Packaging and deployment

Two optional ways to run the application. **Neither is needed** — `npm run dev` in
`frontend/` is the primary path and everything the assignment asks about happens there.
These exist because a single artefact is convenient to hand over.

Both serve the identical application, and in both the comparison still runs in the
reviewer's browser in a Web Worker. **The interval the timing markers bracket is the same
however the files are delivered.**

---

## As a single jar

Requires Java 21 and Maven.

```bash
cd frontend && npm run build && cd ..
mvn spring-boot:run          # http://localhost:8080
```

**Static file hosting and nothing else.** One Java class,
[`FastVisualDifferenceApplication`](src/main/java/com/fastvisualdifference/FastVisualDifferenceApplication.java),
whose entire body is `SpringApplication.run(...)`. No controller, no configuration class,
and no image data crosses into Java.

Maven copies `frontend/dist/fvd/browser` onto the classpath under `static/`; it does not
invoke npm, so the two builds stay independent. If the frontend has not been built the
Maven build **fails immediately** with the command to run — rather than producing a jar that
starts cleanly and serves nothing.

The result is a 20 MB self-contained jar, which is what the Docker image runs.

---

## In Docker

The only route that needs nothing installed but Docker.

```bash
docker compose up --build     # http://localhost:8080
```

Or without compose:

```bash
docker build -t fast-visual-difference .
docker run --rm -p 8080:8080 fast-visual-difference
```

Three stages — Node builds the Angular app, Maven packages the jar, and a **JRE** image
runs it. Only the jar crosses into the final image, so `node_modules` and the compilers stay
behind: **228 MB**, against the **649 MB** build stage it came out of
(`docker build --target backend` reproduces that figure). It runs as a non-root user.

**`docker-compose.yml` is shorthand for one `docker run`, not orchestration.** There is one
service because there is one process and it serves static files — no database, no queue,
nothing to schedule between.
