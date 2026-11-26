# Build stage
FROM node:26-slim AS build

WORKDIR /app

# Install dependencies
COPY ./frontend/package*.json ./
RUN npm ci

# Copy source code
COPY ./frontend/ .

# Build frontend
RUN npm run build

# Production stage
FROM nginx:stable-alpine AS runtime

# Copy built frontend
COPY --from=build /app/fe/browser /usr/share/nginx/html/lissy

# Configure nginx
COPY ./frontend/nginx.conf /etc/nginx/conf.d/default.conf

CMD ["nginx", "-g", "daemon off;"]
