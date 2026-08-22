FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
# Copy the lockfile and use `npm ci` for reproducible, lockfile-pinned installs
# (npm install would re-resolve ^ ranges and could pull untested versions).
COPY package.json package-lock.json ./
RUN npm ci

# Production-only dependency tree. A separate stage rather than an `npm prune`
# in the build stage: it resolves in parallel with the build, and leaves the
# build's own tree untouched so a rebuild does not have to reinstall.
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Build
FROM deps AS build
COPY . .
RUN npm run build

# Production image
FROM base AS runner
ENV NODE_ENV=production

WORKDIR /app
COPY --from=build /app/dist ./dist
# From prod-deps, not build: the build stage's node_modules is a full install
# including vitest, playwright, and typescript, none of which the server needs.
# Copying that wholesale shipped roughly 190 extra packages into production.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./

EXPOSE 4321
ENV PORT=4321
ENV HOST=0.0.0.0

CMD ["node", "dist/server/entry.mjs"]
