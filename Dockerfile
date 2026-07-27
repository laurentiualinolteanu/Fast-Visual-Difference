# Builds and runs the application without Node, a JDK or Maven on the host.
#
# Three stages, because the tools that build this thing are much larger than the thing
# itself: a JDK and a Node toolchain come to well over a gigabyte, and none of it is
# needed to serve static files. Only the jar crosses into the final image.
#
#   docker build -t fast-visual-difference .
#   docker run --rm -p 8080:8080 fast-visual-difference
#
# The application is identical to the one `npm run dev` serves. Docker changes how it is
# delivered and changes nothing about what the assignment measures — the comparison still
# runs in the browser, in a Web Worker, on the reviewer's machine.

# ---- 1. Build the Angular application ---------------------------------------------
FROM node:22-alpine AS frontend

WORKDIR /build/frontend

# Dependencies first, as their own layer: the manifest changes far less often than the
# source, so editing a component does not re-run `npm ci`.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---- 2. Package the jar -------------------------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS backend

WORKDIR /build

# Same reasoning: resolve dependencies before the sources arrive.
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline

COPY src ./src
# The Maven build packages an already-built frontend and refuses to run without one, so
# stage 1's output has to land exactly where the enforcer rule looks for it.
COPY --from=frontend /build/frontend/dist ./frontend/dist

RUN mvn -B -q package -DskipTests

# ---- 3. Run -------------------------------------------------------------------------
# A JRE, not a JDK: nothing is compiled at runtime, and the compiler is the larger half.
FROM eclipse-temurin:21-jre-alpine

# Serving files needs no privileges, and a container that cannot write to its own image is
# one less thing to reason about.
RUN addgroup -S app && adduser -S -G app app
USER app

WORKDIR /app
COPY --from=backend /build/target/*.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
