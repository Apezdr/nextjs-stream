FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat docker-cli
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./
RUN \
  if [ -f package-lock.json ]; then npm ci --force --legacy-peer-deps; \
  else echo "Lockfile not found." && exit 1; \
  fi


# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED=1

RUN \
  if [ -f yarn.lock ]; then yarn run build; \
  elif [ -f package-lock.json ]; then npm run build --legacy-peer-deps; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm run build; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED=1

# ============================================================================
# OpenTelemetry Configuration for SigNoz Integration
# ============================================================================
# These can be overridden at runtime via docker-compose or docker run
ENV OTEL_ENABLED="false"
ENV OTEL_SERVICE_NAME="nextjs-stream"
ENV OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4318"
ENV OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"

# Resource attributes for better trace identification in SigNoz
ENV OTEL_RESOURCE_ATTRIBUTES="deployment.environment=production,service.version=latest,service.namespace=nextjs-stream"

# Distributed tracing propagators
ENV OTEL_PROPAGATORS="tracecontext,baggage"

# Sampling configuration - sample everything by default
ENV OTEL_TRACES_SAMPLER="always_on"

# Next.js OpenTelemetry verbose logging (0=off, 1=on)
ENV NEXT_OTEL_VERBOSE="0"
# ============================================================================

RUN apk add --no-cache libc6-compat docker-cli
RUN apk add --no-cache wget tar && \
    wget -O /tmp/dotenvx.tar.gz https://github.com/dotenvx/dotenvx/releases/download/v1.52.0/dotenvx-1.52.0-linux-x86_64.tar.gz && \
    tar -xzf /tmp/dotenvx.tar.gz -C /usr/local/bin/ && \
    rm /tmp/dotenvx.tar.gz
#RUN addgroup --system --gid 1001 nodejs
#RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# ============================================================================
# Copy OpenTelemetry instrumentation files
# These are needed for the instrumentation to work with standalone output
# ============================================================================
COPY --from=builder /app/src/instrumentation.ts ./src/instrumentation.ts
COPY --from=builder /app/node_modules/@vercel ./node_modules/@vercel
COPY --from=builder /app/node_modules/@opentelemetry ./node_modules/@opentelemetry
COPY --from=builder /app/node_modules/pino ./node_modules/pino
# If you have the lib/tracing.ts utilities, they'll be bundled automatically
# ============================================================================

RUN dotenvx ext prebuild

#USER nextjs

EXPOSE 3000

ENV PORT=3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/config/next-config-js/output
ENV HOSTNAME="0.0.0.0"
CMD ["dotenvx", "run", "--", "node", "server.js"]