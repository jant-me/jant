# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

ARG JANT_BUILD_ID=""

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0
ENV JANT_BUILD_ID=$JANT_BUILD_ID

RUN corepack enable

WORKDIR /src

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jant/core i18n:compile
RUN pnpm --filter @jant/core build
RUN pnpm --filter @jant/core deploy --legacy --prod /app

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/var/lib/jant

WORKDIR /app

RUN mkdir -p /app /var/lib/jant /usr/local/bin \
  && chown -R node:node /app /var/lib/jant /usr/local/bin

COPY --from=build --chown=node:node /app /app

# `jant` on the PATH, as docs/cli.md says: `docker exec … jant migrate`.
RUN ln -s /app/bin/jant.js /usr/local/bin/jant

USER node

VOLUME ["/var/lib/jant"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/healthz').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "bin/jant.js", "start"]
