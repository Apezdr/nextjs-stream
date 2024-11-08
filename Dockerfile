# Stage 1: Building the code
FROM node:current-alpine as builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install -g npm@10.3.0
RUN npm install --force
COPY . .
RUN npm run build

# Stage 2: Running the code
FROM node:current-alpine
WORKDIR /app
COPY --from=builder /app/ ./
EXPOSE 3232

# Use environment variables from docker-compose.yml at runtime
CMD ["npm", "start"]
