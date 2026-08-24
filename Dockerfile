# Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Source: https://github.com/BZFlag-Dev/bzo
# See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html

# Pin the supported Node.js runtime for each Ubuntu base and verify each architecture independently.
ARG UBUNTU_VERSION=24.04
ARG NODE_VERSION_UBUNTU24=24.19.0
ARG NODE_VERSION_UBUNTU26=24.19.0
ARG NODE_SHA256_UBUNTU24_AMD64=724802c45237477dbe5777923743e6c77906830cae03a82b5653ebd75b301dda
ARG NODE_SHA256_UBUNTU24_ARM64=2913e8544d95c8be9e6034c539ec0584014532166a088bf742629756c3ec42e2
ARG NODE_SHA256_UBUNTU26_AMD64=f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4
ARG NODE_SHA256_UBUNTU26_ARM64=d28c8a5bf0a808f0ed434a1dce8c54ae98f0371c0bd86ac58abc613f73e6643f

FROM ubuntu:${UBUNTU_VERSION}

ARG UBUNTU_VERSION
ARG NODE_VERSION_UBUNTU24
ARG NODE_VERSION_UBUNTU26
ARG NODE_SHA256_UBUNTU24_AMD64
ARG NODE_SHA256_UBUNTU24_ARM64
ARG NODE_SHA256_UBUNTU26_AMD64
ARG NODE_SHA256_UBUNTU26_ARM64
ARG TARGETARCH
RUN case "${UBUNTU_VERSION}" in \
      24.04|26.04) ;; \
      *) echo "Unsupported Ubuntu version: ${UBUNTU_VERSION}" >&2; exit 1 ;; \
    esac

ENV NODE_ENV=production \
    PORT=3000 \
    SERVER_CONFIG_PATH=/data/server-config.json \
    DEBIAN_FRONTEND=noninteractive

RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl libstdc++6; \
    case "${UBUNTU_VERSION}" in \
      24.04) node_version="${NODE_VERSION_UBUNTU24}" ;; \
      26.04) node_version="${NODE_VERSION_UBUNTU26}" ;; \
      *) echo "Unsupported Ubuntu version: ${UBUNTU_VERSION}" >&2; exit 1 ;; \
    esac; \
    case "${TARGETARCH}" in \
      amd64) node_arch=x64 ;; \
      arm64) node_arch=arm64 ;; \
      *) echo "Unsupported target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    case "${UBUNTU_VERSION}:${TARGETARCH}" in \
      24.04:amd64) node_checksum="${NODE_SHA256_UBUNTU24_AMD64}" ;; \
      24.04:arm64) node_checksum="${NODE_SHA256_UBUNTU24_ARM64}" ;; \
      26.04:amd64) node_checksum="${NODE_SHA256_UBUNTU26_AMD64}" ;; \
      26.04:arm64) node_checksum="${NODE_SHA256_UBUNTU26_ARM64}" ;; \
      *) echo "Unsupported Ubuntu and architecture combination" >&2; exit 1 ;; \
    esac; \
    node_archive="node-v${node_version}-linux-${node_arch}.tar.gz"; \
    curl --fail --silent --show-error --location --retry 3 \
      --output "/tmp/${node_archive}" \
      "https://nodejs.org/dist/v${node_version}/${node_archive}"; \
    echo "${node_checksum}  /tmp/${node_archive}" | sha256sum --check --strict; \
    tar --extract --gzip --file "/tmp/${node_archive}" \
      --strip-components=1 --directory /usr/local; \
    test "$(node --version)" = "v${node_version}"; \
    rm -f "/tmp/${node_archive}"; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/*

RUN useradd --system --create-home --shell /bin/bash node

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

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
