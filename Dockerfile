# syntax=docker/dockerfile:1

# --- build stage: compile TypeScript -> dist/ ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
# --ignore-scripts so the `prepare` (tsc) hook doesn't run mid-install;
# we build explicitly once sources are in place.
RUN npm ci --ignore-scripts && npm run build

# --- runtime stage: production deps + compiled output only ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist

# freshjots-mcp speaks MCP over stdio. The Fresh Jots API token is supplied at
# run time (FRESHJOTS_TOKEN), so the server starts tokenless for introspection.
ENTRYPOINT ["node", "dist/index.js"]
