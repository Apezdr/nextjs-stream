# Stage 1: Building the code
FROM node:22-alpine3.19 as builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install -g npm@10.3.0
RUN npm install --force
COPY . .
RUN npm run build

# Stage 2: Running the code
FROM node:22-alpine3.19
WORKDIR /app
COPY --from=builder /app/ ./
EXPOSE 3232

# Use environment variables from docker-compose.yml at runtime
CMD ["npm", "start"]
