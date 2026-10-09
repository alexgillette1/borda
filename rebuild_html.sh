#!/bin/bash

# Borda build script
# Outputs:
#   demo-user/index.html  — full app experience (borda.ai/demo-user)
#   index.html            — waitlist landing page (borda.ai root, copied from waitlist.html)

OUTDIR="/sessions/blissful-stoic-brahmagupta/mnt/outputs/demo-user"
OUTFILE="$OUTDIR/index.html"
JSXFILE="/sessions/blissful-stoic-brahmagupta/mnt/outputs/Borda.jsx"
ROOTDIR="/sessions/blissful-stoic-brahmagupta/mnt/outputs"

mkdir -p "$OUTDIR"

# Write the HTML header
cat > "$OUTFILE" << 'HEADER'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Borda - Save money, earn spins, win real stocks. The gamified savings app.">
  <meta name="theme-color" content="#0B0E11">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Borda - Save. Spin. Win Real Stocks.</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎰</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    html, body, #root {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script type="text/babel" data-type="module">
HEADER

# Strip the import line and write the JSX source inline
echo "const { useState, useEffect, useRef, useCallback, useMemo } = React;" >> "$OUTFILE"
echo "" >> "$OUTFILE"

# Skip line 1 (import statement) and append the rest
tail -n +2 "$JSXFILE" >> "$OUTFILE"

# Write the footer
cat >> "$OUTFILE" << 'FOOTER'

// ==================== MOUNT ====================
const rootEl = document.getElementById('root');
const root = ReactDOM.createRoot(rootEl);
root.render(React.createElement(Borda));
  </script>
</body>
</html>
FOOTER

echo "App built: $(wc -l < "$OUTFILE") lines → demo-user/index.html"

# Copy waitlist as root index.html
cp "$ROOTDIR/waitlist.html" "$ROOTDIR/index.html"
echo "Root landing: $(wc -l < "$ROOTDIR/index.html") lines → index.html (waitlist)"
