FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json tsconfig.json vitest.config.ts ./
RUN npm ci
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY examples/ ./examples/

# Test stage: typecheck + unit tests (build halts on failure)
FROM base AS test
RUN npm run typecheck && npm test

# Builder stage
FROM test AS builder
RUN npm run package

# Dev stage: serves the packaged file on :3000
FROM base AS dev
EXPOSE 3000
CMD ["npm", "run", "dev"]
