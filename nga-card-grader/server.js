import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

// Serve static files from the dist directory
// IMPORTANT: { index: false } prevents Express from automatically serving index.html
// This ensures the request falls through to the '*' handler below where we inject the API key
app.use(express.static(path.join(__dirname, 'dist'), { index: false }));

// Handle all other routes by serving index.html with injected environment variables
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  
  fs.readFile(indexPath, 'utf8', (err, htmlData) => {
    if (err) {
      console.error('Error reading index.html file', err);
      return res.status(500).send('Error loading application.');
    }

    // Inject environment variables into the HTML
    // Note: Only expose safe variables that are needed by the client
    const apiKey = process.env.VITE_API_KEY || '';
    
    // Safety check: Warn in logs if key is missing (but don't crash)
    if (!apiKey) {
      console.warn('Warning: VITE_API_KEY is not set in the server environment.');
    }

    const injectedScript = `
      <script>
        window.env = {
          VITE_API_KEY: "${apiKey}"
        };
      </script>
    `;

    // Inject before </head>
    const result = htmlData.replace('</head>', `${injectedScript}</head>`);
    
    res.send(result);
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});