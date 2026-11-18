# Relay server image. Build context is the repository root (the relay is part of the Cargo workspace):
#   docker build -f relay-server/Dockerfile -t key-intercept-relay .
FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY loopback-core loopback-core
COPY loopback-server loopback-server
COPY relay-server relay-server
COPY installer installer
RUN cargo build --release --locked -p relay-server

FROM debian:bookworm-slim
COPY --from=build /src/target/release/relay-server /usr/local/bin/relay-server
ENV RELAY_PORT=35491
EXPOSE 35491
USER nobody
CMD ["relay-server"]
