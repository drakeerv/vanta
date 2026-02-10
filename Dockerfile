# ── Frontend build ───────────────────────────────────────────
FROM oven/bun:1-alpine AS frontend

WORKDIR /app/frontend

COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile

COPY frontend/ ./
RUN bun run build

# ── Backend build ────────────────────────────────────────────
FROM rust:1.92-alpine AS builder

RUN apk add --no-cache musl-dev nasm

WORKDIR /app

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock ./

# Create dummy src to cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release && rm -rf src target/release/deps/vanta*

# Copy real source and build
COPY src ./src
RUN cargo build --release --locked

# ── Runtime stage ────────────────────────────────────────────
FROM scratch

WORKDIR /app

# Copy the statically-linked binary
COPY --from=builder /app/target/release/vanta .

# Copy the built SPA
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Expose port
EXPOSE 3000

# Run the application
ENTRYPOINT ["./vanta"]
