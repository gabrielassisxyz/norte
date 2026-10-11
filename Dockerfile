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
# stage keeps exactly one FROM and still pins the version. The tarball is
# checked against the SHASUMS256.txt nodejs.org publishes for that release
# before it is unpacked. TARGETARCH is set by the builder; Node names the two
# architectures x64 and arm64.
ARG NODE_VERSION=24.18.0
ARG TARGETARCH
RUN case "${TARGETARCH:-amd64}" in \
        amd64) node_arch=x64 ;; \
        arm64) node_arch=arm64 ;; \
        *) echo "unsupported TARGETARCH '${TARGETARCH}'" >&2; exit 1 ;; \
    esac \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && node_tar="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    && cd /tmp \
    && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${node_tar}" \
    && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
    && grep " ${node_tar}\$" SHASUMS256.txt | sha256sum -c - \
    && tar -xJf "${node_tar}" -C /usr/local --strip-components=1 \
    && rm "${node_tar}" SHASUMS256.txt \
    && node --version \
    && npm --version

WORKDIR /src
COPY . .
RUN bin/generate
ARG VERSION=dev
RUN cd server && CGO_ENABLED=0 go build -trimpath \
    -ldflags "-s -w -X github.com/gabrielassisxyz/norte/server/internal/app.Version=${VERSION}" \
    -o /out/norte ./cmd/norte

# scratch has no shell, so the data directory is prepared here with the
# ownership the server runs as. A named volume initialised from it keeps that
# ownership on first start, which is what makes the first start succeed.
RUN mkdir -p -m 0700 /out/data && chown 65532:65532 /out/data

# SQLite spills to a temporary file when a statement outgrows memory, as a
# table rebuild in a migration does, and scratch has no /tmp: without one the
# migration fails with "disk I/O error" (SQLITE_IOERR_GETTEMPPATH).
RUN mkdir -p -m 1777 /out/tmp

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/norte /norte
COPY --from=build --chown=65532:65532 --chmod=0700 /out/data /data
COPY --from=build --chmod=1777 /out/tmp /tmp
USER 65532
ENV NORTE_LISTEN=0.0.0.0:8080 NORTE_DATA=/data
EXPOSE 8080
ENTRYPOINT ["/norte", "serve"]
