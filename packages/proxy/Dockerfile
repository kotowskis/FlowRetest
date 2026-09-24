# Built from the package directory after `npm run build` at the repo root:
#   docker build -t flowretest-proxy:dev packages/proxy
# Base image pinned by digest (node:22-alpine, 2026-09-23); dependencies come from packages/proxy/package-lock.json
# (a standalone lock: the workspace lock at the root does not apply inside the image).
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY dist ./dist
RUN mkdir -p /rules /capture /ca && chown -R node:node /app /rules /capture /ca
USER node
EXPOSE 8080
CMD ["node", "dist/bin.js"]
