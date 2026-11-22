# The Lambda image: Next's standalone server behind the AWS Lambda Web Adapter, for linux/arm64.
# Built from the repository root: docker buildx build -f deploy/Dockerfile .
#
# Both base images are pinned by digest, and pulled from ECR Public (its Docker official images
# mirror carries the same digests as Docker Hub), so a build never takes an image nobody reviewed
# and never meets Docker Hub's anonymous pull limit. Moving either pin is a reviewed commit.

FROM public.ecr.aws/docker/library/node:22.23.5-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Lifecycle scripts stay off: nothing in the tree needs one, and they are where a compromised
# package runs its code
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run test:run

# The Firebase web config is public by design (firestore.rules guard the data); it is compiled into
# the browser bundle, so it is needed at build time only. It comes from the build's environment,
# never from the repository.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
RUN test -n "$NEXT_PUBLIC_FIREBASE_PROJECT_ID" && npm run build

FROM public.ecr.aws/docker/library/node:22.23.5-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0@sha256:17cfd08eff1dfea3f6a9a1e9c65fdac80aa4919b6085e746615530f43f57d2f1 /lambda-adapter /opt/extensions/lambda-adapter

# The server listens on loopback only; the adapter, in the same sandbox, is its one client
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=127.0.0.1 \
    AWS_LWA_PORT=3000 \
    AWS_LWA_READINESS_CHECK_PATH=/

WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Lambda's filesystem is read-only apart from /tmp, where Next may keep its cache. /tmp starts
# empty on each new instance, so the link's target is made before the server starts.
RUN ln -s /tmp/next-cache .next/cache

USER node
CMD ["sh", "-c", "mkdir -p /tmp/next-cache && exec node server.js"]
