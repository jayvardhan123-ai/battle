# Use lightweight Node Alpine base image
FROM node:18-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package files first to leverage Docker build cache
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production

# Copy the rest of the project source files
COPY . .

# Hugging Face Spaces binds traffic to port 7860 by default
EXPOSE 7860

# Start the Node.js game server
CMD ["node", "server.js"]
