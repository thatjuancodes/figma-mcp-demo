import { useEffect, useState, useMemo } from 'react';
import './App.css';

// Utility to recursively collect all nodes with absoluteBoundingBox
function collectNodesWithBBox(node, arr = []) {
  if (node.absoluteBoundingBox) arr.push(node);
  if (node.children) node.children.forEach(child => collectNodesWithBBox(child, arr));
  return arr;
}

function FigmaNode({ node, offset, scale }) {
  // Only handle RECTANGLE and TEXT for demo
  if (node.type === 'RECTANGLE') {
    const style = {
      position: 'absolute',
      left: ((node.absoluteBoundingBox?.x || 0) - offset.x) * scale,
      top: ((node.absoluteBoundingBox?.y || 0) - offset.y) * scale,
      width: (node.absoluteBoundingBox?.width || 0) * scale,
      height: (node.absoluteBoundingBox?.height || 0) * scale,
      background: node.fills && node.fills[0] && node.fills[0].type === 'SOLID'
        ? `rgba(${Math.round(node.fills[0].color.r * 255)},${Math.round(node.fills[0].color.g * 255)},${Math.round(node.fills[0].color.b * 255)},${node.fills[0].color.a})`
        : 'transparent',
      border: '1px solid #ccc',
      boxSizing: 'border-box',
    };
    return <div style={style}></div>;
  }
  if (node.type === 'TEXT') {
    const style = {
      position: 'absolute',
      left: ((node.absoluteBoundingBox?.x || 0) - offset.x) * scale,
      top: ((node.absoluteBoundingBox?.y || 0) - offset.y) * scale,
      width: (node.absoluteBoundingBox?.width || 0) * scale,
      height: (node.absoluteBoundingBox?.height || 0) * scale,
      color: '#222',
      fontSize: (node.style?.fontSize || 16) * scale,
      fontFamily: node.style?.fontFamily || 'sans-serif',
      whiteSpace: 'pre-wrap',
      display: 'flex',
      alignItems: 'center',
    };
    return <div style={style}>{node.characters}</div>;
  }
  // Recursively render children
  if (node.children) {
    return node.children.map(child => <FigmaNode key={child.id} node={child} offset={offset} scale={scale} />);
  }
  return null;
}

function App() {
  const [figmaData, setFigmaData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedPageId, setSelectedPageId] = useState(null);
  const [generatedHtml, setGeneratedHtml] = useState('');
  const [serverMessage, setServerMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const ws = new window.WebSocket('ws://localhost:8080');
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setFigmaData(data);
        setError(null);
      } catch (e) {
        setError('Failed to parse Figma data');
        console.error("Parsing error:", e, event.data);
      }
    };
    ws.onerror = (err) => {
        setError('WebSocket error. Check if the server is running.');
        console.error('WebSocket error:', err);
    }
    ws.onclose = () => {
        console.log('WebSocket closed');
    }
    return () => {
        ws.close();
    }
  }, []);

  const pages = useMemo(() => figmaData?.document?.children || [], [figmaData]);
  const selectedPage = useMemo(() => pages.find(p => p.id === selectedPageId) || pages[0], [pages, selectedPageId]);

  useEffect(() => {
    if (pages.length && !selectedPageId) {
      setSelectedPageId(pages[0].id);
    }
  }, [pages, selectedPageId]);

  const { offset, scale, viewWidth, viewHeight } = useMemo(() => {
    if (!selectedPage) return { offset: { x: 0, y: 0 }, scale: 1, viewWidth: 900, viewHeight: 600 };
    const nodes = collectNodesWithBBox(selectedPage);
    if (!nodes.length) return { offset: { x: 0, y: 0 }, scale: 1, viewWidth: 900, viewHeight: 600 };
    
    const minX = Math.min(...nodes.map(n => n.absoluteBoundingBox.x));
    const minY = Math.min(...nodes.map(n => n.absoluteBoundingBox.y));
    const maxX = Math.max(...nodes.map(n => n.absoluteBoundingBox.x + (n.absoluteBoundingBox.width || 0)));
    const maxY = Math.max(...nodes.map(n => n.absoluteBoundingBox.y + (n.absoluteBoundingBox.height || 0)));
    
    const pageWidth = (maxX - minX) || 1;
    const pageHeight = (maxY - minY) || 1;
    
    const targetViewWidth = 900; 
    const targetViewHeight = 600;
    
    let newScale = 1;
    if (pageWidth > targetViewWidth || pageHeight > targetViewHeight) {
        newScale = Math.min(targetViewWidth / pageWidth, targetViewHeight / pageHeight);
    }
    
    return { 
        offset: { x: minX, y: minY }, 
        scale: newScale, 
        viewWidth: targetViewWidth, 
        viewHeight: targetViewHeight 
    };
  }, [selectedPage]);

  const handleGenerateHtml = async () => {
    if (!selectedPage) {
      alert("Please select a page first.");
      return;
    }
    setIsGenerating(true);
    setGeneratedHtml('');
    setServerMessage('');
    setError(null);

    console.log("Sending Figma page data to backend:", selectedPage);

    try {
      const response = await fetch('/api/generate-html', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(selectedPage),
      });

      const resultJson = await response.json(); // Expecting JSON response

      if (!response.ok) {
        throw new Error(resultJson.details || `Server responded with ${response.status}`);
      }
      
      setServerMessage(resultJson.message); // Display server's success message
      if (resultJson.htmlContent) {
        setGeneratedHtml(resultJson.htmlContent); // Set HTML content for preview and download
      } else {
        // Should not happen if backend sends htmlContent on success
        setGeneratedHtml('<p>HTML content was not provided by the server.</p>'); 
      }

    } catch (error) {
      console.error('Error generating HTML:', error);
      setError(`Failed to generate HTML: ${error.message}`);
      setGeneratedHtml('<p style="color: red;">Error fetching or processing HTML from backend.</p>');
      setServerMessage('');
    }

    setIsGenerating(false);
  };

  const handleDownloadHtml = () => {
    if (!generatedHtml || generatedHtml.startsWith('<p style="color: red;') || generatedHtml.startsWith('<p>HTML content was not provided')) {
      alert("No valid HTML content to download or an error occurred.");
      return;
    }
    // Use the selected page name for the download, sanitize it
    const safePageName = selectedPage?.name?.replace(/[^a-z0-9_\-\.]/gi, '_') || 'generated-page';
    const filename = `${safePageName}.html`;
    const blob = new Blob([generatedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Figma Live Design Viewer</h1>
        {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      </header>
      <main>
        {figmaData ? (
          <div className="controls-and-view">
            <div className="controls">
              <h2>Document: {figmaData.name}</h2>
              <label htmlFor="page-select">Select Page: </label>
              <select
                id="page-select"
                value={selectedPageId || ''}
                onChange={e => setSelectedPageId(e.target.value)}
                disabled={!pages.length}
              >
                {!pages.length && <option>Loading pages...</option>}
                {pages.map(page => (
                  <option key={page.id} value={page.id}>{page.name}</option>
                ))}
              </select>
              
              {selectedPage && (
                <button 
                  onClick={handleGenerateHtml} 
                  disabled={isGenerating}
                  style={{ marginTop: '10px' }}
                >
                  {isGenerating ? 'Generating HTML...' : 'Generate HTML with Gemini'}
                </button>
              )}
            </div>

            <div 
              className="figma-render-area"
              style={{
                width: viewWidth,
                height: viewHeight,
              }}
            >
              {selectedPage?.children && selectedPage.children.map(node => (
                <FigmaNode key={node.id} node={node} offset={offset} scale={scale} />
              ))} 
              {!selectedPage && <p>No page selected or page has no children.</p>}
            </div>
            
            {isGenerating && <p className="loading-gemini">Contacting Gemini via backend... please wait.</p>}
            
            {serverMessage && <p className="server-message">{serverMessage}</p>}
            
            {generatedHtml && (
              <div className="generated-html-output">
                <h3>Gemini Output (Preview):</h3>
                <div dangerouslySetInnerHTML={{ __html: generatedHtml }} />
                {generatedHtml && !generatedHtml.startsWith('<p style="color: red;') && !generatedHtml.startsWith('<p>HTML content was not provided') && (
                  <button onClick={handleDownloadHtml} style={{ marginTop: '10px' }}>
                    Download HTML
                  </button>
                )}
              </div>
            )}

          </div>
        ) : (
          <p className="loading-figma">Waiting for Figma data via WebSocket...</p>
        )}
      </main>
    </div>
  );
}

export default App;
