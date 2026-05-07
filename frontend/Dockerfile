# Stage 1: Build the React Application
FROM node:24-alpine AS build

WORKDIR /app

# Install dependencies first (caching)
COPY package.json package-lock.json* ./
RUN npm config set registry https://registry.npmmirror.com && npm install

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Replace default Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
