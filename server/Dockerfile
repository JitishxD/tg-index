FROM oven/bun:1
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock* ./
RUN bun install --production
COPY . .
EXPOSE 8080
CMD ["bun", "src/index.ts"]
