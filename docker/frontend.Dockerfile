# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Copy package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY frontend/ ./

# Build the application (Vite build will transpile TS but won't fail on type errors)
RUN npx vite build

# Production stage with nginx
FROM nginx:1.27-alpine AS prod

# Copy built files
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom nginx config if needed
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
