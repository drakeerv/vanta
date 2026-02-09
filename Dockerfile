FROM rust:1.92-alpine AS builder

RUN apk add --no-cache musl-dev

WORKDIR /app

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock ./

# Create dummy src to cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release && rm -rf src target/release/deps/vanta*

# Copy real source and build
COPY src ./src
RUN cargo build --release --locked

# Runtime stage - scratch for minimal size (~15MB total)
FROM scratch

WORKDIR /app

# Copy the statically-linked binary
COPY --from=builder /app/target/release/vanta /vanta

# Copy static assets and templates
COPY public /public
COPY templates /templates

# Expose port
EXPOSE 3000

# Run the application
ENTRYPOINT ["/vanta"]
