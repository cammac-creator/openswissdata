# syntax=docker/dockerfile:1.7
# ---------- Stage 1: build ----------
FROM node:22-alpine AS build
WORKDIR /app

# Install everything (dev deps included so we can run tsc).
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# Strip dev deps after build to keep the runtime image small.
RUN npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app

# Create a non-root user — Glama / Smithery require this for security review.
RUN addgroup -S app && adduser -S app -G app

# Copy artefacts only — no source, no test, no toolchain.
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json README.md LICENSE ./

USER app

# STDIO MCP servers run as a one-shot child process. The container's
# default command is the binary itself.
ENTRYPOINT ["node", "dist/index.js"]
