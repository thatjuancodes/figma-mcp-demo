// add a websocket server to connect to figma MCP server
import WebSocket, { WebSocketServer } from 'ws';
import 'dotenv/config';
import fetch from 'node-fetch';
import express from 'express';
import http from 'http';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// --- HTTP Server Setup with Express ---
const app = express();
const server = http.createServer(app);

// Middleware to parse JSON bodies
app.use(express.json({ limit: '50mb' }));

// --- WebSocket Server Setup (attached to HTTP server) ---
const wss = new WebSocketServer({ server });

wss.on('connection', function connection(ws) {
  console.log('Client connected to WebSocket');
  ws.on('message', function message(data) {
    const messageString = data.toString();
    console.log('WebSocket received: %s', messageString);
  });
  ws.on('close', () => {
    console.log('Client disconnected from WebSocket');
  });
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

async function fetchFigmaFile(fileKey) {
  console.log(`Fetching Figma file: ${fileKey} using token: ${process.env.FIGMA_API_TOKEN ? 'Present' : 'MISSING'}`);
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: {
      'X-Figma-Token': process.env.FIGMA_API_TOKEN,
    },
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Figma API request failed: ${response.status} ${response.statusText} - ${errorBody}`);
  }
  return response.json();
}

const FIGMA_FILE_KEY = 'jWaq2LpehD8w3JFTorfXpz';

setInterval(async () => {
  try {
    const data = await fetchFigmaFile(FIGMA_FILE_KEY);
    const jsonData = JSON.stringify(data);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(jsonData);
      }
    });
  } catch (error) {
    console.error('Error fetching or broadcasting Figma data:', error);
  }
}, 10000);

// Initialize Gemini AI client
// Ensure GEMINI_API_KEY is in your .env file
let genAI;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
} else {
  console.error('ERROR: GEMINI_API_KEY is not set. HTML generation will fail.');
}

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the temporary directory for HTML outputs
const TEMP_HTML_DIR = path.join(__dirname, 'temp_html_outputs');

// Ensure the temporary directory exists
fs.mkdir(TEMP_HTML_DIR, { recursive: true }).catch(console.error);

app.post('/api/generate-html', async (req, res) => {
  console.log('POST /api/generate-html endpoint hit on backend!');
  const figmaPageData = req.body;

  if (!figmaPageData || !figmaPageData.name || !figmaPageData.id) {
    return res.status(400).send('Error: Figma page data (including name and id) is required.');
  }

  if (!genAI) {
    return res.status(500).send('Error: Gemini AI client not initialized. Check GEMINI_API_KEY.');
  }

  console.log(`Received Figma page "${figmaPageData.name}", preparing to call Gemini API.`);

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const figmaJsonString = JSON.stringify(figmaPageData, null, 2);
    const prompt = `
      You are an expert web developer specializing in converting design specifications into clean, functional HTML and CSS.
      Your task is to convert the provided Figma page JSON data into a single, well-structured HTML file.
      The Figma JSON includes a tree of nodes. Key properties for each node include:
      - 'type': (e.g., 'RECTANGLE', 'TEXT', 'FRAME', 'GROUP')
      - 'name': The layer name from Figma.
      - 'absoluteBoundingBox': An object with 'x', 'y', 'width', 'height' for its absolute position and size on the canvas.
      - 'fills': An array of fill properties. For solid colors, look at fills[0].color (r, g, b, a values are 0-1).
      - 'strokes': Border properties.
      - 'strokeWeight': Border thickness.
      - 'characters': Text content for 'TEXT' nodes.
      - 'style': For 'TEXT' nodes, this contains font information like 'fontFamily', 'fontWeight', 'fontSize', 'textAlignHorizontal', 'textAlignVertical', 'lineHeightPx', etc.
      - 'children': An array of child nodes for container types like 'FRAME' or 'GROUP'.

      Figma Page Data (a single page object from the Figma file structure):
      ${figmaJsonString}

      Generation Instructions:
      1.  Create a complete HTML5 document (including <!DOCTYPE html>, <html>, <head>, <body>).
      2.  In the <head>, include a <title> (use figmaPageData.name if available) and basic meta tags.
      3.  Create a <style> block in the <head> for CSS.
      4.  Iterate through the top-level children of the provided figmaPageData.
      5.  For each node, generate a corresponding HTML element (e.g., <div>).
      6.  Use CSS within the <style> block to position and style these elements. Create unique class names or IDs if necessary for styling, perhaps based on node names or IDs (prefixed to be valid CSS selectors).
      7.  Apply positioning using 'position: absolute;', 'left', 'top', 'width', 'height' derived from 'absoluteBoundingBox'. IMPORTANT: The Figma 'x' and 'y' in 'absoluteBoundingBox' are global to the Figma canvas. To make the page render correctly with its top-left content near the browser viewport's top-left, you should determine the minimum x and y coordinates of all rendered elements on this specific page, and then offset all 'left' and 'top' CSS properties by subtracting these minimums.
      8.  Convert Figma fill colors (0-1 RGBA) to CSS \`rgba()\` or \`hex\` values for backgrounds.
      9.  For TEXT nodes, use <p>, <span>, <h1>-<h6>, or <div> tags. Apply font styles (family, size, weight, color from fills) via CSS. Handle text alignment.
      10. If a node has children, recursively process them, nesting the HTML elements appropriately.
      11. Aim for semantic HTML where possible, but prioritize accurate visual representation if semantics are unclear from the Figma structure.
      12. Ensure the generated HTML is a single string containing the complete HTML document.
      13. Do NOT include any markdown formatting (like \\\`\\\`\\\`html) or explanatory text outside of the HTML document itself.

      Generate only the HTML code.
    `;

    console.log('Sending prompt to Gemini API...');
    const result = await model.generateContent(prompt);
    const geminiResponse = await result.response;
    const generatedHtml = geminiResponse.text();

    console.log('Received HTML from Gemini API.');

    // Sanitize the figmaPageData.name to make it a valid filename
    // This replaces spaces and common invalid characters with underscores
    const safePageName = figmaPageData.name.replace(/[^a-z0-9_\-\.]/gi, '_');
    const filename = `${safePageName}.html`;
    const filePath = path.join(TEMP_HTML_DIR, filename);

    await fs.writeFile(filePath, generatedHtml, 'utf8');
    console.log(`Successfully saved HTML to ${filePath}`);

    // Respond to the client
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({
      message: `HTML for page '${figmaPageData.name}' generated and saved successfully on server.`,      
      filename: filename, 
      htmlContent: generatedHtml
    });

  } catch (error) {
    console.error('Error in /api/generate-html route:', error);
    let errorMessage = 'Error generating or saving HTML. Check server logs.';
    if (error.message) {
      errorMessage += `Details: ${error.message}`;
    }
    res.status(500).json({ 
      error: "Failed to generate or save HTML", 
      details: errorMessage 
    });
  }
});

app.get('/test-backend-route', (req, res) => {
  console.log('GET /test-backend-route hit!');
  res.send('Backend GET route is working!');
});

// --- Start the Server ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
  console.log(`WebSocket server is also attached and running.`);
});

// This part below from your original code seems to be an attempt to create a client
// within the server, which is usually not what you want for the main server logic.
// If you need to test the WebSocket server *from* the server, it should be done differently.
// Commenting it out to avoid confusion and potential issues.
// const ws = new WebSocket('ws://localhost:8080');
// ws.onmessage = (event) => console.log('Received:', event.data);


