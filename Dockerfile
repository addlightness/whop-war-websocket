FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy server files
COPY . .

# Expose port
EXPOSE 8080

# Start the server
CMD ["node", "websocket.js"]