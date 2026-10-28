FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS builder
WORKDIR /app
# npm bootstraps only the pinned pnpm CLI in this disposable build stage.
RUN npm install --global pnpm@11.23.0
# Keep both workspace manifests with the one shared lockfile, even though only
# the Next application is installed and Cloudflare source is outside this image.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY cloudflare/package.json ./cloudflare/package.json
RUN pnpm --filter sarin-bot-mvp --fail-if-no-match install --frozen-lockfile
COPY . .
# Public Firebase configuration is embedded at build time, never Admin credentials.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node scripts/container-start.mjs ./container-start.mjs
COPY --chown=node:node scripts/lib/cloudflare-credentials.mjs ./lib/cloudflare-credentials.mjs
USER node
EXPOSE 3000
# Exactly one Node process: replicas/clustering would multiply inference slots.
CMD ["node", "container-start.mjs"]
