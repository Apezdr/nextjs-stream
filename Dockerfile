# Stage 1: Building the code
FROM node:21-alpine as builder
WORKDIR /app

COPY package.json package-lock.json* ./
COPY .env.local ./
RUN npm install -g npm@latest
RUN npm install --force
COPY . .
RUN npm run build
RUN rm .env.local

# Stage 2: Running the code
FROM node:21-alpine
WORKDIR /app
COPY --from=builder /app/ ./
EXPOSE 3232
CMD ["npm", "start"]