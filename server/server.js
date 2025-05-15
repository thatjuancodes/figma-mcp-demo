// add a websocket server to connect to figma MCP server
import WebSocket, { WebSocketServer } from 'ws';
import 'dotenv/config';
import fetch from 'node-fetch';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', function connection(ws) {
  ws.on('message', function message(data) {
    console.log('received: %s', data);
  });
});

async function fetchFigmaFile(fileKey) {
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: {
      'X-Figma-Token': process.env.FIGMA_API_TOKEN,
    },
  });
  return response.json();
}

// Example: periodically fetch and broadcast Figma data
const FIGMA_FILE_KEY = 'jWaq2LpehD8w3JFTorfXpz'; // Replace with your file key

setInterval(async () => {
  const data = await fetchFigmaFile(FIGMA_FILE_KEY);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}, 10000); // every 10 seconds

const ws = new WebSocket('ws://localhost:8080');
ws.onmessage = (event) => console.log('Received:', event.data);


