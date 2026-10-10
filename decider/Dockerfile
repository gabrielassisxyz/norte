# The decider sidecar, built by docker-compose.example.yml: a Node service
# that wraps the Laya decision model and answers /decide over HTTP. Unlike
# the main image this one cannot be scratch: the model runs through
# onnxruntime-node, so the runtime is a slim Debian image.
#
# The Node version repeats web/.node-version for the same reason the main
# Dockerfile repeats the Go version: a Dockerfile cannot read that file, it
# repeats the number, and bin/check-pins fails the gate when any copy drifts.
FROM node:24.18.0-slim

# The weights (about 1.7 GB fp32) download from Hugging Face on first use
# into LAYA_CACHE, which stays on a named volume so a rebuilt container does
# not re-download them. The package creates the directory itself; making it
# here with the runtime user's ownership lets a named volume inherit that
# ownership on first start, the same trick /data uses in the main image.
ENV NODE_ENV=production \
    DECIDER_LISTEN=0.0.0.0:8091 \
    LAYA_CACHE=/cache

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN mkdir -p -m 0755 /cache && chown node:node /app /cache
USER node
# --ignore-scripts because the lockfile is the only trusted surface: no
# dependency's install script ever runs. @receptron/laya works without them
# (its unit tests, which install the same way, import the package).
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server.mjs ./

EXPOSE 8091
VOLUME /cache
ENTRYPOINT ["node", "server.mjs"]