const fs = require('fs');
const path = require('path');

// Path to the server.js file
const serverJsPath = path.join(process.cwd(), '.next/standalone/plugins/server.js');

// Read the file content
let serverJs = fs.readFileSync(serverJsPath, 'utf8');

// Modify the some environment variables and default environment variables
serverJs = serverJs
    .replace(/process\.env\.PORT/g, 'process.env.PLUGIN_SERVER_PORT')
    .replace(/process\.env\.HOSTNAME/g, "'0.0.0.0'")
    .replace(/3000/g, '3002');

// Write the modified content back to the server.js file
fs.writeFileSync(serverJsPath, serverJs, 'utf8');

// Move the static directory
// Path for moving the static directory
const staticSrc = path.join(process.cwd(), '.next/static');
const staticDest = path.join(process.cwd(), '.next/standalone/plugins/.next/static');

try {
  // Check if the source directory exists
  if (fs.existsSync(staticSrc)) {
    // Ensure the destination directory exists
    const destDir = path.dirname(staticDest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Move the directory
    fs.renameSync(staticSrc, staticDest);
    console.log('Directory moved successfully:', staticSrc, '->', staticDest);
  } else {
    console.log('Source directory does not exist:', staticSrc);
  }
} catch (error) {
  console.error('Error moving directory:', error);
}


console.log('File modifications complete.');