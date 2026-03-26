# Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Source: https://github.com/BZFlag-Dev/bzo
# See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html

FROM ubuntu:24.04

ENV NODE_ENV=production \
    PORT=3000 \
    SERVER_CONFIG_PATH=/data/server-config.json \
    DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs npm \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --system --create-home --shell /bin/bash node

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY public ./public
COPY maps ./maps
COPY example-server-config.json ./example-server-config.json
COPY server.js ./server.js
COPY LICENSE ./LICENSE
COPY README.md ./README.md
COPY CHANGELOG.md ./CHANGELOG.md

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "server.js"]
