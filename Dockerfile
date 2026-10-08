# Norte ships as one static binary with its frontend embedded, so the runtime
# image is scratch plus the binary, CA certificates and the data directory.
#
# The Go version below repeats server/go.mod's toolchain directive, because a
# Dockerfile cannot read it for the base image it installs. bin/check-pins,
# which bin/ci runs first, fails the gate when this copy drifts. The Node
# version repeats web/.node-version for the same reason: the frontend is built
# in the build stage.
FROM golang:1.26.6 AS build

# Node 24.18.0 for the frontend build, from the official tarball, so this
# stage keeps exactly one FROM and still pins the version.
ARG NODE_VERSION=24.18.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version \
    && npm --version

WORKDIR /src
COPY . .
RUN bin/generate
RUN cd server && CGO_ENABLED=0 go build -o /out/norte ./cmd/norte

# scratch has no shell, so the data directory is prepared here with the
# ownership the server runs as. A named volume initialised from it keeps that
# ownership on first start, which is what makes the first start succeed.
RUN mkdir -p /out/data && chown 65532:65532 /out/data

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/norte /norte
COPY --from=build --chown=65532:65532 /out/data /data
USER 65532
ENV NORTE_LISTEN=0.0.0.0:8080 NORTE_DATA=/data
EXPOSE 8080
ENTRYPOINT ["/norte", "serve"]
