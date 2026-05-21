# cloud-api/Dockerfile
FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies layer (cached unless package.json changes)
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

# Final image
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Non-root user for security
RUN addgroup -g 1001 -S retail && adduser -S retail -u 1001
USER retail

EXPOSE 3001
CMD ["node", "server.js"]
