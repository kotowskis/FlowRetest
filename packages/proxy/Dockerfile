# Built from the package directory after `npm run build` at the repo root:
#   docker build -t flowretest-proxy:dev packages/proxy
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY dist ./dist
RUN mkdir -p /rules /capture /ca && chown -R node:node /app /rules /capture /ca
USER node
EXPOSE 8080
CMD ["node", "dist/bin.js"]
